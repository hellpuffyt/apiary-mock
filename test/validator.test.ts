import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, mountOperations } from "../src/openapi/loader.js";
import { validateRequest, type RequestToValidate } from "../src/validation/validator.js";
import { RequestValidationError } from "../src/validation/errors.js";
import type { MountedOperation } from "../src/openapi/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const petstorePath = path.join(__dirname, "..", "examples", "petstore.yaml");

const doc = loadSpec(petstorePath);
const operations = mountOperations(doc);

function op(operationId: string): MountedOperation {
  const found = operations.find((o) => o.operationId === operationId);
  if (!found) throw new Error(`no such operation ${operationId}`);
  return found;
}

function baseReq(overrides: Partial<RequestToValidate> = {}): RequestToValidate {
  return {
    pathParams: {},
    query: {},
    headers: {},
    rawBodyPresent: false,
    ...overrides,
  };
}

describe("validateRequest — parameters", () => {
  it("accepts a valid path param (uuid) and query params", () => {
    const request = baseReq({
      pathParams: { petId: "11111111-1111-1111-1111-111111111111" },
      query: { status: "available", limit: "5" },
    });
    expect(() => validateRequest(op("getPet"), request)).not.toThrow();
  });

  it("rejects a missing required path param", () => {
    const request = baseReq({ pathParams: {} });
    try {
      validateRequest(op("getPet"), request);
      expect.fail("expected validation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RequestValidationError);
      expect((err as RequestValidationError).issues.some((i) => i.path === "petId")).toBe(true);
    }
  });

  it("rejects a malformed path param (bad uuid format)", () => {
    const request = baseReq({ pathParams: { petId: "not-a-uuid" } });
    expect(() => validateRequest(op("getPet"), request)).toThrow(RequestValidationError);
  });

  it("rejects a query param violating enum", () => {
    const request = baseReq({
      pathParams: {},
      query: { status: "not-a-status" },
    });
    try {
      validateRequest(op("listPets"), request);
      expect.fail("expected validation to throw");
    } catch (err) {
      const issues = (err as RequestValidationError).issues;
      expect(issues.some((i) => i.path === "status" && /enum|one of/.test(i.message))).toBe(true);
    }
  });

  it("rejects a query param violating type (non-integer limit)", () => {
    const request = baseReq({ query: { limit: "abc" } });
    expect(() => validateRequest(op("listPets"), request)).toThrow(RequestValidationError);
  });

  it("rejects a query param violating maximum", () => {
    const request = baseReq({ query: { limit: "9999" } });
    expect(() => validateRequest(op("listPets"), request)).toThrow(RequestValidationError);
  });

  it("accepts a valid optional query param combination", () => {
    const request = baseReq({ query: { limit: "10" } });
    expect(() => validateRequest(op("listPets"), request)).not.toThrow();
  });

  it("accepts a request with no optional params supplied at all", () => {
    const request = baseReq();
    expect(() => validateRequest(op("listPets"), request)).not.toThrow();
  });
});

describe("validateRequest — request body", () => {
  it("accepts a fully valid request body", () => {
    const request = baseReq({
      rawBodyPresent: true,
      contentType: "application/json",
      body: { name: "Rex", category: { id: 1, name: "Dogs" } },
    });
    expect(() => validateRequest(op("createPet"), request)).not.toThrow();
  });

  it("rejects a body missing a required field", () => {
    const request = baseReq({
      rawBodyPresent: true,
      contentType: "application/json",
      body: { name: "Rex" },
    });
    expect(() => validateRequest(op("createPet"), request)).toThrow(RequestValidationError);
  });

  it("rejects a body with wrong field type", () => {
    const request = baseReq({
      rawBodyPresent: true,
      contentType: "application/json",
      body: { name: 12345, category: { id: 1, name: "Dogs" } },
    });
    expect(() => validateRequest(op("createPet"), request)).toThrow(RequestValidationError);
  });

  it("rejects a body with an invalid enum value", () => {
    const request = baseReq({
      rawBodyPresent: true,
      contentType: "application/json",
      body: { name: "Rex", category: { id: 1, name: "Dogs" }, status: "not-a-real-status" },
    });
    expect(() => validateRequest(op("createPet"), request)).toThrow(RequestValidationError);
  });

  it("rejects a missing required body when one is required", () => {
    const request = baseReq({ rawBodyPresent: false });
    expect(() => validateRequest(op("createPet"), request)).toThrow(RequestValidationError);
  });

  it("rejects an unsupported content-type", () => {
    const request = baseReq({
      rawBodyPresent: true,
      contentType: "text/plain",
      body: "hello",
    });
    try {
      validateRequest(op("createPet"), request);
      expect.fail("expected validation to throw");
    } catch (err) {
      const issues = (err as RequestValidationError).issues;
      expect(issues.some((i) => i.location === "content-type")).toBe(true);
    }
  });

  it("rejects a string field shorter than minLength", () => {
    const request = baseReq({
      rawBodyPresent: true,
      contentType: "application/json",
      body: { name: "", category: { id: 1, name: "Dogs" } },
    });
    expect(() => validateRequest(op("createPet"), request)).toThrow(RequestValidationError);
  });

  it("accepts a nested object body (category with required subfields)", () => {
    const request = baseReq({
      rawBodyPresent: true,
      contentType: "application/json",
      body: {
        name: "Rex",
        category: { id: 1, name: "Dogs", parent: { id: 0, name: "Animals" } },
      },
    });
    expect(() => validateRequest(op("createPet"), request)).not.toThrow();
  });

  it("does not require a body for operations without a requestBody", () => {
    const request = baseReq();
    expect(() => validateRequest(op("getPet", ), { ...request, pathParams: { petId: "11111111-1111-1111-1111-111111111111" } })).not.toThrow();
  });
});

describe("validateRequest — strict mode", () => {
  it("rejects an undeclared query parameter in strict mode", () => {
    const request = baseReq({ query: { unknownParam: "x" } });
    expect(() => validateRequest(op("listPets"), request, { strict: true })).toThrow(
      RequestValidationError,
    );
  });

  it("allows an undeclared query parameter outside strict mode", () => {
    const request = baseReq({ query: { unknownParam: "x" } });
    expect(() => validateRequest(op("listPets"), request, { strict: false })).not.toThrow();
  });

  it("still accepts a fully valid request under strict mode (no false positives)", () => {
    const request = baseReq({ query: { status: "available" } });
    expect(() => validateRequest(op("listPets"), request, { strict: true })).not.toThrow();
  });
});
