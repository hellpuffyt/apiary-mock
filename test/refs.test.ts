import { describe, expect, it } from "vitest";
import { resolveRefs } from "../src/openapi/refs.js";

describe("resolveRefs", () => {
  it("resolves a simple local $ref", () => {
    const doc = {
      components: { schemas: { Foo: { type: "string" } } },
      use: { $ref: "#/components/schemas/Foo" },
    };
    const resolved = resolveRefs<typeof doc>(doc);
    expect(resolved.use).toEqual({ type: "string" });
  });

  it("resolves nested $refs (a $ref pointing at a schema that itself contains a $ref)", () => {
    const doc = {
      components: {
        schemas: {
          Spec: { type: "object", properties: { color: { $ref: "#/components/schemas/Color" } } },
          Color: { type: "string", enum: ["red", "green"] },
        },
      },
      use: { $ref: "#/components/schemas/Spec" },
    };
    const resolved = resolveRefs<any>(doc);
    expect(resolved.use.properties.color).toEqual({ type: "string", enum: ["red", "green"] });
  });

  it("resolves three-levels-deep nested refs", () => {
    const doc = {
      components: {
        schemas: {
          Widget: { properties: { part: { $ref: "#/components/schemas/Part" } } },
          Part: { properties: { spec: { $ref: "#/components/schemas/Spec" } } },
          Spec: { properties: { color: { $ref: "#/components/schemas/Color" } } },
          Color: { enum: ["red", "blue"] },
        },
      },
      use: { $ref: "#/components/schemas/Widget" },
    };
    const resolved = resolveRefs<any>(doc);
    expect(resolved.use.properties.part.properties.spec.properties.color).toEqual({
      enum: ["red", "blue"],
    });
  });

  it("resolves refs inside arrays", () => {
    const doc = {
      components: { schemas: { Item: { type: "number" } } },
      list: [{ $ref: "#/components/schemas/Item" }, { $ref: "#/components/schemas/Item" }],
    };
    const resolved = resolveRefs<any>(doc);
    expect(resolved.list).toEqual([{ type: "number" }, { type: "number" }]);
  });

  it("resolves a self-referencing (circular) schema without infinite recursion", () => {
    const doc = {
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { next: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    };
    const resolved = resolveRefs<any>(doc);
    const node = resolved.components.schemas.Node;
    expect(node.properties.next).toBe(node.properties.next.properties.next);
  });

  it("resolves a mutually-circular pair of schemas (A -> B -> A)", () => {
    const doc = {
      components: {
        schemas: {
          A: { properties: { b: { $ref: "#/components/schemas/B" } } },
          B: { properties: { a: { $ref: "#/components/schemas/A" }, name: { type: "string" } } },
        },
      },
    };
    const resolved = resolveRefs<any>(doc);
    const b = resolved.components.schemas.A.properties.b;
    expect(b.properties.name).toEqual({ type: "string" });
    expect(b.properties.a.properties.b).toBe(b);
  });

  it("preserves non-ref sibling keys alongside resolution", () => {
    const doc = {
      components: { schemas: { Foo: { type: "string" } } },
      info: { title: "x", version: "1" },
    };
    const resolved = resolveRefs<any>(doc);
    expect(resolved.info).toEqual({ title: "x", version: "1" });
  });

  it("throws a clear error for an unresolvable $ref", () => {
    const doc = { use: { $ref: "#/components/schemas/Missing" }, components: { schemas: {} } };
    expect(() => resolveRefs(doc)).toThrow(/Missing/);
  });

  it("rejects external (non-local) $refs", () => {
    const doc = { use: { $ref: "other-file.yaml#/Foo" } };
    expect(() => resolveRefs(doc)).toThrow(/local/i);
  });
});
