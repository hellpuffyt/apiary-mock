import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePathTemplate, loadSpec, loadSpecFromString, mountOperations } from "../src/openapi/loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const petstorePath = path.join(__dirname, "..", "examples", "petstore.yaml");
const nestedRefsPath = path.join(__dirname, "fixtures", "nested-refs.json");
const circularPath = path.join(__dirname, "fixtures", "circular.yaml");

describe("loadSpec", () => {
  it("loads a YAML document and resolves refs", () => {
    const doc = loadSpec(petstorePath);
    expect(doc.openapi).toBe("3.0.3");
    const postPets = doc.paths["/pets"]?.post;
    const schema = postPets?.requestBody?.content?.["application/json"]?.schema;
    expect(schema).toBeDefined();
    expect((schema as any).properties.name.type).toBe("string");
  });

  it("loads a JSON document and resolves nested refs", () => {
    const doc = loadSpec(nestedRefsPath);
    const schema: any = doc.paths["/widgets"]?.get?.responses["200"]?.content?.["application/json"]?.schema;
    expect(schema.items.properties.part.properties.spec.properties.color.enum).toEqual([
      "red",
      "green",
      "blue",
    ]);
  });

  it("throws when the document is missing required top-level fields", () => {
    expect(() => loadSpecFromString('{"info": {"title": "x", "version": "1"}}', "bad.json")).toThrow(
      /openapi|paths/,
    );
  });

  it("parses a JSON string body even when given a .yaml extension by sniffing content", () => {
    const doc = loadSpecFromString(
      '{"openapi":"3.0.3","info":{"title":"x","version":"1"},"paths":{}}',
      "spec.yaml",
    );
    expect(doc.openapi).toBe("3.0.3");
  });
});

describe("compilePathTemplate", () => {
  it("compiles a static path", () => {
    const { regex, paramNames } = compilePathTemplate("/pets");
    expect(paramNames).toEqual([]);
    expect(regex.test("/pets")).toBe(true);
    expect(regex.test("/pets/1")).toBe(false);
  });

  it("compiles a path with a single param", () => {
    const { regex, paramNames } = compilePathTemplate("/pets/{petId}");
    expect(paramNames).toEqual(["petId"]);
    expect(regex.test("/pets/abc-123")).toBe(true);
    expect(regex.test("/pets")).toBe(false);
  });

  it("compiles a path with multiple params", () => {
    const { regex, paramNames } = compilePathTemplate("/orgs/{orgId}/repos/{repoId}");
    expect(paramNames).toEqual(["orgId", "repoId"]);
    const match = regex.exec("/orgs/acme/repos/42");
    expect(match?.[1]).toBe("acme");
    expect(match?.[2]).toBe("42");
  });

  it("escapes regex-special characters in literal path segments", () => {
    const { regex } = compilePathTemplate("/v1.0/pets");
    expect(regex.test("/v1.0/pets")).toBe(true);
    expect(regex.test("/v1X0/pets")).toBe(false);
  });
});

describe("mountOperations", () => {
  it("flattens every method under every path into a mounted operation", () => {
    const doc = loadSpec(petstorePath);
    const mounted = mountOperations(doc);
    const methods = mounted.map((m) => `${m.method} ${m.path}`).sort();
    expect(methods).toEqual([
      "delete /pets/{petId}",
      "get /pets",
      "get /pets/{petId}",
      "post /pets",
    ]);
  });

  it("merges path-item-level parameters with operation-level parameters", () => {
    const doc = loadSpec(petstorePath);
    const mounted = mountOperations(doc);
    const getPet = mounted.find((m) => m.operationId === "getPet");
    expect(getPet?.parameters.some((p) => p.name === "petId" && p.in === "path")).toBe(true);
  });

  it("resolves circular schemas without throwing", () => {
    const doc = loadSpec(circularPath);
    const mounted = mountOperations(doc);
    expect(mounted).toHaveLength(1);
  });
});
