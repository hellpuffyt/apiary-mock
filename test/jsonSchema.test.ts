import { describe, expect, it } from "vitest";
import { toJsonSchema } from "../src/validation/jsonSchema.js";
import type { JsonSchema } from "../src/openapi/types.js";

describe("toJsonSchema", () => {
  it("passes through a plain schema unchanged in shape", () => {
    const schema: JsonSchema = { type: "string", minLength: 2 };
    expect(toJsonSchema(schema)).toEqual({ type: "string", minLength: 2 });
  });

  it("converts nullable:true with a scalar type into a type array including null", () => {
    const schema: JsonSchema = { type: "string", nullable: true };
    expect(toJsonSchema(schema)).toEqual({ type: ["string", "null"] });
  });

  it("converts nullable:true with an enum into an enum including null", () => {
    const schema: JsonSchema = { enum: ["a", "b"], nullable: true };
    expect(toJsonSchema(schema)).toEqual({ enum: ["a", "b", null] });
  });

  it("falls back to anyOf for nullable with no explicit type", () => {
    const schema: JsonSchema = { nullable: true };
    const result = toJsonSchema(schema) as any;
    expect(result.anyOf).toBeDefined();
    expect(result.anyOf[1]).toEqual({ type: "null" });
  });

  it("does not mutate the input schema", () => {
    const schema: JsonSchema = { type: "string", nullable: true };
    toJsonSchema(schema);
    expect(schema.nullable).toBe(true);
    expect(schema.type).toBe("string");
  });

  it("breaks a self-referencing schema cycle instead of infinite-looping", () => {
    const node: JsonSchema = { type: "object", properties: {} };
    node.properties = { next: node };
    expect(() => toJsonSchema(node)).not.toThrow();
    const converted = toJsonSchema(node) as any;
    expect(converted.properties.next).toBe(true);
  });

  it("recursively converts nested object properties", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        child: { type: "string", nullable: true },
      },
    };
    const converted = toJsonSchema(schema) as any;
    expect(converted.properties.child.type).toEqual(["string", "null"]);
  });
});
