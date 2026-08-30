import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, mountOperations } from "../src/openapi/loader.js";
import { findNearbyPaths, matchRoute, pathExistsForOtherMethod } from "../src/server/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const doc = loadSpec(path.join(__dirname, "..", "examples", "petstore.yaml"));
const operations = mountOperations(doc);

describe("matchRoute", () => {
  it("matches a static path + method", () => {
    const match = matchRoute(operations, "GET", "/pets");
    expect(match?.operation.operationId).toBe("listPets");
  });

  it("matches a templated path and extracts params", () => {
    const match = matchRoute(operations, "GET", "/pets/abc-123");
    expect(match?.operation.operationId).toBe("getPet");
    expect(match?.pathParams).toEqual({ petId: "abc-123" });
  });

  it("returns undefined for an unknown method on a known path", () => {
    const match = matchRoute(operations, "PATCH", "/pets");
    expect(match).toBeUndefined();
  });

  it("returns undefined for a completely unknown path", () => {
    expect(matchRoute(operations, "GET", "/nope")).toBeUndefined();
  });

  it("decodes URI-encoded path params", () => {
    const match = matchRoute(operations, "GET", "/pets/a%20b");
    expect(match?.pathParams.petId).toBe("a b");
  });
});

describe("pathExistsForOtherMethod", () => {
  it("is true when the path is known under a different method", () => {
    expect(pathExistsForOtherMethod(operations, "/pets")).toBe(true);
  });

  it("is false for a path not in the spec", () => {
    expect(pathExistsForOtherMethod(operations, "/nope")).toBe(false);
  });
});

describe("findNearbyPaths", () => {
  it("suggests the closest known path", () => {
    const nearby = findNearbyPaths(operations, "/pett");
    expect(nearby[0]).toBe("/pets");
  });

  it("respects the limit parameter", () => {
    const nearby = findNearbyPaths(operations, "/p", 1);
    expect(nearby).toHaveLength(1);
  });
});
