import type { JsonSchema } from "../openapi/types.js";

/**
 * Converts an OpenAPI-flavoured schema (which may use the 3.0 `nullable: true` extension)
 * into a plain JSON Schema ajv can compile, without mutating the input.
 *
 * Because `$ref`s have already been resolved to real (possibly circular) object references
 * by the loader, a naive walk of a recursive schema (e.g. `Category.parent -> Category`)
 * would either recurse forever or hand ajv a schema object that is itself a cyclic graph,
 * which ajv's compiler cannot walk. We break the cycle: the first time a node is revisited
 * while it is still being converted, we substitute the permissive `true` schema ("anything
 * goes") instead of looping back to it. That bounds validation depth on recursive schemas —
 * documented as a limitation — while keeping ajv fed a strictly acyclic schema.
 */
export function toJsonSchema(schema: JsonSchema): Record<string, unknown> {
  return convert(schema, new Map(), new Set()) as Record<string, unknown>;
}

function convert(node: unknown, cache: Map<unknown, unknown>, inProgress: Set<unknown>): unknown {
  if (node === null || typeof node !== "object") return node;
  if (inProgress.has(node)) return true;
  const cached = cache.get(node);
  if (cached !== undefined) return cached;

  if (Array.isArray(node)) {
    inProgress.add(node);
    const out: unknown[] = [];
    for (const item of node) out.push(convert(item, cache, inProgress));
    inProgress.delete(node);
    cache.set(node, out);
    return out;
  }

  const obj = node as Record<string, unknown>;
  inProgress.add(node);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "nullable") continue;
    out[key] = convert(value, cache, inProgress);
  }
  inProgress.delete(node);

  let result: Record<string, unknown> = out;
  if (obj.nullable === true) {
    if (typeof out.type === "string") {
      out.type = [out.type, "null"];
    } else if (Array.isArray(out.type)) {
      if (!out.type.includes("null")) out.type = [...out.type, "null"];
    } else if (out.enum && Array.isArray(out.enum)) {
      if (!out.enum.includes(null)) out.enum = [...out.enum, null];
    } else {
      // No explicit type to widen (e.g. free-form object) — allow null via anyOf.
      result = { anyOf: [out, { type: "null" }] };
    }
  }

  cache.set(node, result);
  return result;
}
