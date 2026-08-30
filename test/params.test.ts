import { describe, expect, it } from "vitest";
import { validateParameters } from "../src/validation/params.js";
import type { ValidationIssue } from "../src/validation/errors.js";
import type { OpenApiParameter } from "../src/openapi/types.js";

function run(parameters: OpenApiParameter[], source: Parameters<typeof validateParameters>[1]) {
  const issues: ValidationIssue[] = [];
  validateParameters(parameters, source, issues);
  return issues;
}

describe("validateParameters", () => {
  it("validates a header parameter, case-insensitively", () => {
    const params: OpenApiParameter[] = [
      { name: "X-Request-Id", in: "header", required: true, schema: { type: "string" } },
    ];
    const issues = run(params, { path: {}, query: {}, header: { "x-request-id": "abc" } });
    expect(issues).toHaveLength(0);
  });

  it("flags a missing required header", () => {
    const params: OpenApiParameter[] = [
      { name: "X-Request-Id", in: "header", required: true, schema: { type: "string" } },
    ];
    const issues = run(params, { path: {}, query: {}, header: {} });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.location).toBe("header");
  });

  it("validates an array query parameter's item schema", () => {
    const params: OpenApiParameter[] = [
      {
        name: "tags",
        in: "query",
        schema: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      },
    ];
    const valid = run(params, { path: {}, query: { tags: "a,b" }, header: {} });
    expect(valid).toHaveLength(0);

    const invalid = run(params, { path: {}, query: { tags: "a,z" }, header: {} });
    expect(invalid.length).toBeGreaterThan(0);
  });

  it("validates array minItems/maxItems", () => {
    const params: OpenApiParameter[] = [
      {
        name: "ids",
        in: "query",
        schema: { type: "array", minItems: 2, items: { type: "string" } },
      },
    ];
    const issues = run(params, { path: {}, query: { ids: "only-one" }, header: {} });
    expect(issues.some((i) => /at least/.test(i.message))).toBe(true);
  });

  it("treats an array query param already split by the framework as-is", () => {
    const params: OpenApiParameter[] = [
      { name: "ids", in: "query", schema: { type: "array", items: { type: "integer" } } },
    ];
    const issues = run(params, { path: {}, query: { ids: ["1", "2"] }, header: {} });
    expect(issues).toHaveLength(0);
  });

  it("does not flag an absent optional parameter", () => {
    const params: OpenApiParameter[] = [
      { name: "q", in: "query", required: false, schema: { type: "string" } },
    ];
    expect(run(params, { path: {}, query: {}, header: {} })).toHaveLength(0);
  });

  it("validates numeric bounds on a query param", () => {
    const params: OpenApiParameter[] = [
      { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
    ];
    const issues = run(params, { path: {}, query: { page: "0" }, header: {} });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("validates a boolean query param", () => {
    const params: OpenApiParameter[] = [{ name: "active", in: "query", schema: { type: "boolean" } }];
    expect(run(params, { path: {}, query: { active: "true" }, header: {} })).toHaveLength(0);
    expect(run(params, { path: {}, query: { active: "yes" }, header: {} }).length).toBeGreaterThan(0);
  });
});
