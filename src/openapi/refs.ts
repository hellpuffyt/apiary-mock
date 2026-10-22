/**
 * Resolves local JSON `$ref` pointers ("#/components/schemas/Foo") within an already-parsed
 * OpenAPI document, including nested refs and circular refs.
 *
 * Every resolved object/array is registered (by the identity of its source node) before its
 * children are resolved, and a `$ref` resolves to that same registered object. Anything that
 * points at a target while it is still being resolved therefore receives the final object
 * reference, so cycles close correctly instead of recursing forever.
 */
export function resolveRefs<T>(root: unknown): T {
  const resolving = new Set<string>();
  // Already-resolved plain (non-$ref) nodes, by identity. YAML anchors/aliases parse to
  // shared objects; without this memo every alias would be deep-copied, so a small
  // document with nested aliases ("billion laughs") expanded exponentially and exhausted
  // memory. Reusing the resolved node keeps the output the same size as the input graph
  // (and also terminates on any alias cycle).
  const resolvedNodes = new WeakMap<object, unknown>();

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
      // Own properties only: "#/__proto__" or "#/constructor" must not reach Object.prototype.
      if (node === null || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, part)) {
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

    const memo = resolvedNodes.get(node);
    if (memo !== undefined) return memo;

    if (Array.isArray(node)) {
      const outArr: unknown[] = [];
      resolvedNodes.set(node, outArr);
      for (const item of node) outArr.push(resolveNode(item));
      return outArr;
    }

    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === "string") {
      const pointer = obj.$ref;
      const target = getByPointer(pointer);
      // A target already being (or fully) resolved is returned by identity: this is what
      // closes schema cycles such as Node.next -> Node.
      const known = target !== null && typeof target === "object" ? resolvedNodes.get(target) : undefined;
      if (known !== undefined) return known;
      if (resolving.has(pointer)) {
        throw new Error(`Cannot resolve $ref "${pointer}": circular $ref chain with no schema in between`);
      }
      resolving.add(pointer);
      try {
        return resolveNode(target);
      } finally {
        resolving.delete(pointer);
      }
    }

    const out: Record<string, unknown> = {};
    resolvedNodes.set(node, out);
    for (const key of Object.keys(obj)) {
      out[key] = resolveNode(obj[key]);
    }
    return out;
  }

  return resolveNode(root) as T;
}
