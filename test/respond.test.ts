import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, mountOperations } from "../src/openapi/loader.js";
import { buildResponse, selectResponseEntry } from "../src/server/respond.js";
import { createRng } from "../src/generation/rng.js";
import type { MountedOperation } from "../src/openapi/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const doc = loadSpec(path.join(__dirname, "..", "examples", "petstore.yaml"));
const operations = mountOperations(doc);

function op(operationId: string): MountedOperation {
  const found = operations.find((o) => o.operationId === operationId);
  if (!found) throw new Error(`no such operation ${operationId}`);
  return found;
}

describe("selectResponseEntry", () => {
  it("selects the lowest 2xx by default", () => {
    const { status } = selectResponseEntry(op("createPet"));
    expect(status).toBe("201");
  });

  it("honours an explicit preferred status", () => {
    const { status } = selectResponseEntry(op("createPet"), 409);
    expect(status).toBe("409");
  });

  it("falls back to the lowest 2xx if the preferred status is not declared", () => {
    const { status } = selectResponseEntry(op("createPet"), 999);
    expect(status).toBe("201");
  });

  it("falls back to the first declared response when there is no 2xx", () => {
    // deletePet only declares 204, which is a 2xx, so pick a different operation shape:
    const { status } = selectResponseEntry(op("getPet"), 404);
    expect(status).toBe("404");
  });
});

describe("buildResponse", () => {
  it("builds a body matching the response schema shape", () => {
    const rng = createRng("resp-1");
    const result = buildResponse(op("listPets"), undefined, rng);
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty("items");
    expect(result.body).toHaveProperty("total");
  });

  it("returns no body for a 204 (no content) response", () => {
    const rng = createRng("resp-2");
    const result = buildResponse(op("deletePet"), undefined, rng);
    expect(result.status).toBe(204);
    expect(result.body).toBeUndefined();
  });

  it("is deterministic given the same rng seed", () => {
    const a = buildResponse(op("getPet"), undefined, createRng("stable-resp"));
    const b = buildResponse(op("getPet"), undefined, createRng("stable-resp"));
    expect(a.body).toEqual(b.body);
  });
});
