import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMatchingScenario, loadScenarios, type Scenario } from "../src/scenarios/scenarios.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("loadScenarios", () => {
  it("loads scenarios from the example YAML file", () => {
    const scenarios = loadScenarios(path.join(__dirname, "..", "examples", "scenarios.yaml"));
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]?.response.status).toBeDefined();
  });

  it("throws a clear error when the top-level shape is wrong", () => {
    // reuse the openapi example as a deliberately-invalid scenarios file
    expect(() => loadScenarios(path.join(__dirname, "..", "examples", "petstore.yaml"))).toThrow(
      /scenarios/,
    );
  });
});

describe("findMatchingScenario", () => {
  const scenarios: Scenario[] = [
    {
      name: "generic GET /pets",
      match: { method: "GET", path: "/pets" },
      response: { status: 200, body: { generic: true } },
    },
    {
      name: "GET /pets with status=sold",
      match: { method: "GET", path: "/pets", query: { status: "sold" } },
      response: { status: 200, body: { sold: true } },
    },
    {
      name: "POST /pets with a specific body",
      match: { method: "POST", path: "/pets", body: { name: "Duplicate" } },
      response: { status: 409, body: { conflict: true } },
    },
  ];

  it("matches on method + path", () => {
    const result = findMatchingScenario(scenarios, {
      method: "GET",
      path: "/pets",
      query: {},
    });
    expect(result?.response.body).toEqual({ generic: true });
  });

  it("prefers the more specific matcher (method+path+query) over a looser one", () => {
    const result = findMatchingScenario(scenarios, {
      method: "GET",
      path: "/pets",
      query: { status: "sold" },
    });
    expect(result?.response.body).toEqual({ sold: true });
  });

  it("falls back to the looser matcher when the specific query doesn't match", () => {
    const result = findMatchingScenario(scenarios, {
      method: "GET",
      path: "/pets",
      query: { status: "available" },
    });
    expect(result?.response.body).toEqual({ generic: true });
  });

  it("matches on a body predicate (partial deep match)", () => {
    const result = findMatchingScenario(scenarios, {
      method: "POST",
      path: "/pets",
      query: {},
      body: { name: "Duplicate", category: { id: 1, name: "Dogs" } },
    });
    expect(result?.response.status).toBe(409);
  });

  it("does not match when the body predicate fails", () => {
    const result = findMatchingScenario(scenarios, {
      method: "POST",
      path: "/pets",
      query: {},
      body: { name: "SomethingElse" },
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when method matches but path does not", () => {
    const result = findMatchingScenario(scenarios, {
      method: "GET",
      path: "/other",
      query: {},
    });
    expect(result).toBeUndefined();
  });

  it("supports pathPattern regex matching", () => {
    const patternScenarios: Scenario[] = [
      {
        match: { pathPattern: "^/pets/[0-9a-f-]+$" },
        response: { status: 200, body: { matched: "pattern" } },
      },
    ];
    const result = findMatchingScenario(patternScenarios, {
      method: "GET",
      path: "/pets/abc-123",
      query: {},
    });
    expect(result?.response.body).toEqual({ matched: "pattern" });
  });

  it("breaks ties between equally-specific matchers using declaration order", () => {
    const tied: Scenario[] = [
      { match: { method: "GET", path: "/x" }, response: { status: 200, body: { first: true } } },
      { match: { method: "GET", path: "/x" }, response: { status: 200, body: { second: true } } },
    ];
    const result = findMatchingScenario(tied, { method: "GET", path: "/x", query: {} });
    expect(result?.response.body).toEqual({ first: true });
  });
});
