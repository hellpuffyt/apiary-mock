/**
 * Resolves local JSON `$ref` pointers ("#/components/schemas/Foo") within an already-parsed
 * OpenAPI document, including nested refs and circular refs.
 *
 * Circular refs are handled by allocating a placeholder object for a ref target the first
 * time it is encountered, registering it before recursing into it, and mutating it in place
 * once resolution completes. Anything that pointed at the placeholder during resolution keeps
 * that same object reference, so cycles close correctly instead of recursing forever.
 */
export function resolveRefs<T>(root: unknown): T {
  const resolving = new Map<string, unknown>();

  function getByPointer(pointer: string): unknown {
    if (!pointer.startsWith("#/")) {
      throw new Error(
        `Only local $ref pointers are supported (got "${pointer}"). External file refs are out of scope.`,
      );
    }
    const parts = pointer
      .slice(2)
      .split("/")
      .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
    let node: unknown = root;
    for (const part of parts) {
      if (node === null || typeof node !== "object") {
        throw new Error(`Cannot resolve $ref "${pointer}": path does not exist`);
      }
      node = (node as Record<string, unknown>)[part];
    }
    if (node === undefined) {
      throw new Error(`Cannot resolve $ref "${pointer}": target not found`);
    }
    return node;
  }

  function resolveNode(node: unknown): unknown {
    if (node === null || typeof node !== "object") return node;

    if (Array.isArray(node)) {
      return node.map((item) => resolveNode(item));
    }

    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === "string") {
      const pointer = obj.$ref;
      const existing = resolving.get(pointer);
      if (existing !== undefined) return existing;

      const target = getByPointer(pointer);
      const placeholder: Record<string, unknown> | unknown[] = Array.isArray(target) ? [] : {};
      resolving.set(pointer, placeholder);

      const resolvedTarget = resolveNode(target);
      if (Array.isArray(resolvedTarget) && Array.isArray(placeholder)) {
        placeholder.push(...resolvedTarget);
      } else if (!Array.isArray(resolvedTarget) && !Array.isArray(placeholder)) {
        Object.assign(placeholder, resolvedTarget as Record<string, unknown>);
      }
      return placeholder;
    }

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = resolveNode(obj[key]);
    }
    return out;
  }

  return resolveNode(root) as T;
}
