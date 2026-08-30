import { describe, expect, it } from "vitest";
import { generateValue } from "../src/generation/generator.js";
import { createRng } from "../src/generation/rng.js";
import type { JsonSchema } from "../src/openapi/types.js";

describe("generateValue", () => {
  it("prefers an explicit example over generation", () => {
    const schema: JsonSchema = { type: "string", example: "fixed-value" };
    expect(generateValue(schema, { seed: "s" })).toBe("fixed-value");
  });

  it("prefers examples map when present", () => {
    const schema: JsonSchema = { type: "string", examples: { a: { value: "from-examples" } } };
    expect(generateValue(schema, { seed: "s" })).toBe("from-examples");
  });

  it("picks a value from enum", () => {
    const schema: JsonSchema = { enum: ["a", "b", "c"] };
    const value = generateValue(schema, { seed: "s" });
    expect(["a", "b", "c"]).toContain(value);
  });

  it("generates integers within minimum/maximum", () => {
    const schema: JsonSchema = { type: "integer", minimum: 5, maximum: 10 };
    for (let i = 0; i < 50; i++) {
      const value = generateValue(schema, { seed: `s${i}` }) as number;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it("generates numbers within minimum/maximum", () => {
    const schema: JsonSchema = { type: "number", minimum: 0, maximum: 1 };
    for (let i = 0; i < 50; i++) {
      const value = generateValue(schema, { seed: `n${i}` }) as number;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("generates strings respecting minLength/maxLength", () => {
    const schema: JsonSchema = { type: "string", minLength: 10, maxLength: 15 };
    for (let i = 0; i < 20; i++) {
      const value = generateValue(schema, { seed: `str${i}` }) as string;
      expect(value.length).toBeGreaterThanOrEqual(10);
      expect(value.length).toBeLessThanOrEqual(15);
    }
  });

  it("generates a valid uuid for format: uuid", () => {
    const schema: JsonSchema = { type: "string", format: "uuid" };
    const value = generateValue(schema, { seed: "u" }) as string;
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates a valid date-time for format: date-time", () => {
    const schema: JsonSchema = { type: "string", format: "date-time" };
    const value = generateValue(schema, { seed: "dt" }) as string;
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Number.isNaN(Date.parse(value))).toBe(false);
  });

  it("generates a plausible email for format: email", () => {
    const schema: JsonSchema = { type: "string", format: "email" };
    const value = generateValue(schema, { seed: "e" }) as string;
    expect(value).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it("generates a boolean", () => {
    const schema: JsonSchema = { type: "boolean" };
    expect(typeof generateValue(schema, { seed: "b" })).toBe("boolean");
  });

  it("generates required object properties always, optional ones probabilistically", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        nickname: { type: "string" },
      },
    };
    for (let i = 0; i < 20; i++) {
      const value = generateValue(schema, { seed: `obj${i}` }) as Record<string, unknown>;
      expect(value).toHaveProperty("id");
    }
  });

  it("generates arrays honouring minItems/maxItems", () => {
    const schema: JsonSchema = {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: { type: "integer", minimum: 0, maximum: 1 },
    };
    for (let i = 0; i < 20; i++) {
      const value = generateValue(schema, { seed: `arr${i}` }) as unknown[];
      expect(value.length).toBeGreaterThanOrEqual(2);
      expect(value.length).toBeLessThanOrEqual(4);
    }
  });

  it("generates a string matching a feasible pattern", () => {
    const schema: JsonSchema = { type: "string", pattern: "^[A-Z]{3}-[0-9]{4}$" };
    const value = generateValue(schema, { seed: "p1" }) as string;
    expect(value).toMatch(/^[A-Z]{3}-[0-9]{4}$/);
  });

  it("is deterministic under a fixed seed", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["id", "count", "name"],
      properties: {
        id: { type: "string", format: "uuid" },
        count: { type: "integer", minimum: 0, maximum: 1000 },
        name: { type: "string", minLength: 3, maxLength: 20 },
      },
    };
    const a = generateValue(schema, { seed: "fixed-seed-42" });
    const b = generateValue(schema, { seed: "fixed-seed-42" });
    expect(a).toEqual(b);
  });

  it("produces different output for different seeds (sanity, not a hard guarantee)", () => {
    const schema: JsonSchema = { type: "string", minLength: 20, maxLength: 20 };
    const a = generateValue(schema, { seed: "seed-a" });
    const b = generateValue(schema, { seed: "seed-b" });
    expect(a).not.toEqual(b);
  });

  it("resolves allOf by merging member schemas' properties and required", () => {
    const schema: JsonSchema = {
      allOf: [
        { type: "object", required: ["name"], properties: { name: { type: "string" } } },
        { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      ],
    };
    const value = generateValue(schema, { seed: "allof" }) as Record<string, unknown>;
    expect(value).toHaveProperty("name");
    expect(value).toHaveProperty("id");
  });

  it("resolves oneOf by generating from one of the member schemas", () => {
    const schema: JsonSchema = {
      oneOf: [{ type: "string" }, { type: "integer" }],
    };
    const value = generateValue(schema, { seed: "oneof" });
    expect(["string", "number"]).toContain(typeof value);
  });

  it("does not stack-overflow on a self-referencing schema object", () => {
    const node: JsonSchema = { type: "object", properties: {} };
    node.properties = { next: node };
    expect(() => generateValue(node, { seed: "circular" })).not.toThrow();
  });

  it("accepts a pre-built rng for callers that manage their own randomness stream", () => {
    const rng = createRng("shared");
    const schema: JsonSchema = { type: "integer", minimum: 0, maximum: 100 };
    expect(typeof generateValue(schema, { rng })).toBe("number");
  });
});
