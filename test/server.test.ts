import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec } from "../src/openapi/loader.js";
import { loadScenarios } from "../src/scenarios/scenarios.js";
import { createMockServer, type MockServer } from "../src/server/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const petstorePath = path.join(__dirname, "..", "examples", "petstore.yaml");
const scenariosPath = path.join(__dirname, "..", "examples", "scenarios.yaml");

const doc = loadSpec(petstorePath);
const scenarios = loadScenarios(scenariosPath);

let activeServer: MockServer | undefined;

async function startServer(options: Parameters<typeof createMockServer>[0]) {
  const mock = createMockServer(options);
  activeServer = mock;
  const address = await mock.listen(0, "127.0.0.1");
  return { mock, baseUrl: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  if (activeServer) {
    await activeServer.close();
    activeServer = undefined;
  }
});

describe("createMockServer — real HTTP", () => {
  it("serves a generated 2xx response for a valid request", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-1" });
    const res = await fetch(`${baseUrl}/pets`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json() as any;
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
  });

  it("returns 422 for a request that violates the spec", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-2" });
    const res = await fetch(`${baseUrl}/pets?status=bogus`);
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("returns 404 for an unmounted path", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-3" });
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("includes nearby path suggestions on 404 in strict mode", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-4", strict: true });
    const res = await fetch(`${baseUrl}/pett`);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.nearbyPaths).toContain("/pets");
  });

  it("omits nearby path suggestions on 404 outside strict mode", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-5", strict: false });
    const res = await fetch(`${baseUrl}/pett`);
    const body = await res.json() as any;
    expect(body.nearbyPaths).toBeUndefined();
  });

  it("prefers the requested status code via preferStatus", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-6", preferStatus: 409 });
    const res = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Rex", category: { id: 1, name: "Dogs" } }),
    });
    expect(res.status).toBe(409);
  });

  it("defaults to the lowest 2xx status when no preference is set", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-7" });
    const res = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Rex", category: { id: 1, name: "Dogs" } }),
    });
    expect(res.status).toBe(201);
  });

  it("replays a scenario response instead of generating one", async () => {
    const { baseUrl } = await startServer({ doc, scenarios, seed: "http-8" });
    const res = await fetch(`${baseUrl}/pets/11111111-1111-1111-1111-111111111111`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe("Fixture Fido");
  });

  it("scenario replay takes precedence and skips normal validation", async () => {
    const { baseUrl } = await startServer({ doc, scenarios, seed: "http-9" });
    const res = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Duplicate" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.code).toBe("CONFLICT");
  });

  it("applies artificial latency via --delay", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-10", delayMs: 150 });
    const start = Date.now();
    await fetch(`${baseUrl}/pets`);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(140);
  });

  it("injects failures under --fail-rate", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-11", failRate: 1 });
    const res = await fetch(`${baseUrl}/pets`);
    expect(res.status).toBe(500);
  });

  it("never fails when --fail-rate is 0", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-12", failRate: 0 });
    const res = await fetch(`${baseUrl}/pets`);
    expect(res.status).toBe(200);
  });

  it("produces deterministic bodies across two servers started with the same seed", async () => {
    const first = await startServer({ doc, seed: "same-seed" });
    const res1 = await fetch(`${first.baseUrl}/pets/11111111-1111-1111-1111-111111111111`);
    const body1 = await res1.json();
    await first.mock.close();
    activeServer = undefined;

    const second = await startServer({ doc, seed: "same-seed" });
    const res2 = await fetch(`${second.baseUrl}/pets/11111111-1111-1111-1111-111111111111`);
    const body2 = await res2.json();

    expect(body1).toEqual(body2);
  });

  it("rejects a POST body missing a required field with 422 and issue details", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-13" });
    const res = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "NoCategory" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-14" });
    const res = await fetch(`${baseUrl}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
  });

  it("handles DELETE with a 204 empty body", async () => {
    const { baseUrl } = await startServer({ doc, seed: "http-15" });
    const res = await fetch(`${baseUrl}/pets/11111111-1111-1111-1111-111111111111`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("prints a startup summary listing every mounted operation", async () => {
    const { mock } = await startServer({ doc, seed: "http-16" });
    expect(mock.operations.map((o) => o.operationId).sort()).toEqual([
      "createPet",
      "deletePet",
      "getPet",
      "listPets",
    ]);
  });
});
