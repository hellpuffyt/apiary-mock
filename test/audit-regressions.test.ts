import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormatsImport from "ajv-formats";
import { loadSpec, loadSpecFromString, mountOperations } from "../src/openapi/loader.js";
import { resolveRefs } from "../src/openapi/refs.js";
import { createMockServer, type MockServer } from "../src/server/server.js";
import { buildResponse } from "../src/server/respond.js";
import { createRng } from "../src/generation/rng.js";
import { generateValue } from "../src/generation/generator.js";
import { matchRoute } from "../src/server/router.js";
import { toJsonSchema } from "../src/validation/jsonSchema.js";
import { validateParameters } from "../src/validation/params.js";
import type { ValidationIssue } from "../src/validation/errors.js";
import type { JsonSchema, OpenApiParameter } from "../src/openapi/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const petstorePath = path.join(__dirname, "..", "examples", "petstore.yaml");

const addFormats = addFormatsImport as unknown as (instance: Ajv) => void;
// An independent validator (draft-07 dialect, float-tolerant multipleOf) to check generated output.
const referenceAjv = new Ajv({ strict: false, allErrors: true, multipleOfPrecision: 9 });
addFormats(referenceAjv);

let activeServer: MockServer | undefined;
afterEach(async () => {
  if (activeServer) await activeServer.close();
  activeServer = undefined;
});

async function start(spec: string, extra: Partial<Parameters<typeof createMockServer>[0]> = {}) {
  const mock = createMockServer({ doc: loadSpecFromString(spec, "spec.yaml"), seed: "audit", ...extra });
  activeServer = mock;
  const { port } = await mock.listen(0, "127.0.0.1");
  return `http://127.0.0.1:${port}`;
}

/** Sends a request with an exact raw path (fetch would normalise it). */
function rawRequest(
  baseUrl: string,
  rawPath: string,
  init: { method?: string; body?: Buffer | string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  const { port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: rawPath, method: init.method ?? "GET", headers: init.headers },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

const PATH_SPEC = `
openapi: "3.0.3"
info: { title: t, version: "1" }
paths:
  /files/{name}:
    get:
      parameters:
        - { name: name, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { type: object }
`;

describe("request paths", () => {
  it("answers 400 (not 500) for malformed percent-encoding", async () => {
    const base = await start(PATH_SPEC);
    const res = await rawRequest(base, "/files/%E0%A4%A");
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/percent-encoding/);
  });

  it("decodes a path parameter exactly once (a literal % stays a %)", async () => {
    const base = await start(PATH_SPEC);
    // %25 is a literal "%". Previously the path was decoded twice and "100%" threw -> 500.
    const res = await rawRequest(base, "/files/100%25");
    expect(res.status).toBe(200);
    // And an encoded slash stays inside the parameter instead of creating a new segment.
    const res2 = await rawRequest(base, "/files/a%2Fb");
    expect(res2.status).toBe(200);
  });

  it("matchRoute decodes each segment once and keeps %2F inside the parameter", () => {
    const ops = mountOperations(loadSpecFromString(PATH_SPEC, "spec.yaml"));
    expect(matchRoute(ops, "GET", "/files/100%25")?.pathParams).toEqual({ name: "100%" });
    expect(matchRoute(ops, "GET", "/files/a%2Fb")?.pathParams).toEqual({ name: "a/b" });
    expect(matchRoute(ops, "GET", "/files/%2525")?.pathParams).toEqual({ name: "%25" });
    expect(matchRoute(ops, "GET", "/files/")).toBeUndefined();
  });

  it("rejects request bodies larger than maxBodyBytes with 413", async () => {
    const base = await start(PATH_SPEC.replace("get:", "post:"), { maxBodyBytes: 1024 });
    const res = await rawRequest(base, "/files/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(4096, 0x20),
    });
    expect(res.status).toBe(413);
  });
});

describe("OpenAPI 3.0 boolean exclusive bounds", () => {
  const spec = `
openapi: "3.0.3"
info: { title: t, version: "1" }
paths:
  /items:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                qty: { type: integer, minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: true }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { type: integer, minimum: 0, exclusiveMinimum: true, maximum: 3, exclusiveMaximum: true }
`;

  it("are converted for ajv instead of making every request a 500", async () => {
    const base = await start(spec);
    const ok = await rawRequest(base, "/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qty: 5 }),
    });
    expect(ok.status).toBe(201);
    for (const qty of [0, 10]) {
      const bad = await rawRequest(base, "/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qty }),
      });
      expect(bad.status).toBe(422);
    }
  });

  it("are converted to the numeric form by toJsonSchema", () => {
    expect(toJsonSchema({ type: "number", minimum: 1, exclusiveMinimum: true })).toEqual({
      type: "number",
      exclusiveMinimum: 1,
    });
    expect(toJsonSchema({ type: "number", maximum: 1, exclusiveMaximum: false })).toEqual({
      type: "number",
      maximum: 1,
    });
  });

  it("are honoured by parameter validation", () => {
    const params: OpenApiParameter[] = [
      { name: "n", in: "query", schema: { type: "integer", minimum: 0, exclusiveMinimum: true } },
      { name: "m", in: "query", schema: { type: "number", exclusiveMaximum: 5 } },
      { name: "k", in: "query", schema: { type: "integer", multipleOf: 5 } },
    ];
    const issues: ValidationIssue[] = [];
    validateParameters(params, { path: {}, query: { n: "0", m: "5", k: "7" }, header: {} }, issues);
    expect(issues.map((i) => i.path).sort()).toEqual(["k", "m", "n"]);
    const none: ValidationIssue[] = [];
    validateParameters(params, { path: {}, query: { n: "1", m: "4.5", k: "10" }, header: {} }, none);
    expect(none).toEqual([]);
  });
});

describe("number parameters are parsed strictly", () => {
  const params: OpenApiParameter[] = [{ name: "x", in: "query", schema: { type: "number" } }];
  it.each([" ", "0x10", "Infinity", "1_000", "1,5", "--1"])("rejects %j", (raw) => {
    const issues: ValidationIssue[] = [];
    validateParameters(params, { path: {}, query: { x: raw }, header: {} }, issues);
    expect(issues).toHaveLength(1);
  });
  it.each(["0", "-1.5", "1e3", ".5", "2."])("accepts %j", (raw) => {
    const issues: ValidationIssue[] = [];
    validateParameters(params, { path: {}, query: { x: raw }, header: {} }, issues);
    expect(issues).toEqual([]);
  });
});

describe("multipleOf with decimal steps", () => {
  it("accepts 0.3 for multipleOf 0.1 in a request body (no float false positive)", async () => {
    const base = await start(`
openapi: "3.0.3"
info: { title: t, version: "1" }
paths:
  /p:
    post:
      requestBody:
        content:
          application/json:
            schema: { type: object, properties: { price: { type: number, multipleOf: 0.1 } } }
      responses:
        "204": { description: ok }
`);
    const res = await rawRequest(base, "/p", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: 0.3 }),
    });
    expect(res.status).toBe(204);
  });
});

describe("generated values satisfy their schema (checked by an independent ajv)", () => {
  const schemas: JsonSchema[] = [
    { type: "integer", maximum: -5 },
    { type: "number", maximum: -5 },
    { type: "integer", minimum: 1, maximum: 10, exclusiveMinimum: true, exclusiveMaximum: true },
    { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 3 },
    { type: "number", minimum: 0, maximum: 0.01, exclusiveMinimum: true, exclusiveMaximum: true },
    { type: "integer", multipleOf: 7 },
    { type: "integer", multipleOf: 5, exclusiveMinimum: 10, maximum: 20 },
    { type: "number", multipleOf: 0.1, minimum: 0.25, maximum: 0.75 },
    { type: "string", maxLength: 0 },
    { type: "string", minLength: 20, maxLength: 20 },
    { type: "array", maxItems: 0, items: { type: "string" } },
    { type: "array", items: { type: "integer", enum: [1, 2] }, uniqueItems: true, minItems: 2 },
    {
      type: "object",
      minProperties: 3,
      properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "string" } },
    },
  ];

  it.each(schemas.map((s) => [JSON.stringify(s), s] as const))("%s", (_label, schema) => {
    const validate = referenceAjv.compile(toJsonSchema(schema));
    for (let i = 0; i < 200; i++) {
      const value = generateValue(schema, { seed: `seed-${i}` });
      expect(validate(value), `seed-${i} -> ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it("every generated petstore response body validates against its declared schema", () => {
    const doc = loadSpec(petstorePath);
    const ops = mountOperations(doc);
    let checked = 0;
    for (const op of ops) {
      for (const [status, response] of Object.entries(op.operation.responses)) {
        const media = response.content?.["application/json"];
        if (!media?.schema || media.example !== undefined || media.examples) continue;
        const validate = referenceAjv.compile(toJsonSchema(media.schema));
        for (let i = 0; i < 100; i++) {
          const built = buildResponse(op, Number(status), createRng(`pet-${i}`));
          expect(validate(built.body), `${op.method} ${op.path} ${status}: ${JSON.stringify(validate.errors)}`).toBe(
            true,
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("invalid and hostile specs", () => {
  const head = 'openapi: "3.0.3"\ninfo: { title: t, version: "1" }\n';
  it.each([
    ["unsupported version", 'openapi: "4.0.0"\ninfo: { title: t, version: "1" }\npaths: {}\n', /3\.0\.x and 3\.1\.x/],
    ["unquoted numeric version", "openapi: 3.0\ninfo: { title: t, version: '1' }\npaths: {}\n", /must be a string/],
    ["paths as a list", `${head}paths: [1, 2]\n`, /"paths" must be an object/],
    ["operation without responses", `${head}paths:\n  /a:\n    get: {}\n`, /"responses" must be a non-empty object/],
    ["operation not an object", `${head}paths:\n  /a:\n    get: 5\n`, /operation must be an object/],
    ["path without leading slash", `${head}paths:\n  a:\n    get: { responses: { "200": { description: x } } }\n`, /must start with "\/"/],
    [
      "bad parameter location",
      `${head}paths:\n  /a:\n    get:\n      parameters: [{ name: q, in: body }]\n      responses: { "200": { description: x } }\n`,
      /invalid "in"/,
    ],
    ["$ref into Object.prototype", `${head}paths:\n  /a:\n    get: { responses: { "200": { $ref: "#/__proto__" } } }\n`, /path does not exist/],
  ])("rejects %s at load time", (_label, source, message) => {
    expect(() => loadSpecFromString(source, "spec.yaml")).toThrow(message);
  });

  it("loads a small YAML alias bomb without exponential expansion", () => {
    let yaml = `${head}paths: {}\nx-a0: &a0 [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]\n`;
    for (let i = 1; i < 9; i++) {
      yaml += `x-a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`).join(", ")}]\n`;
    }
    // 10^9 leaves if every alias were copied; previously this exhausted the heap.
    const started = Date.now();
    const doc = loadSpecFromString(yaml, "bomb.yaml") as unknown as Record<string, unknown[]>;
    expect(Date.now() - started).toBeLessThan(2000);
    expect(doc["x-a8"]?.[0]).toBe(doc["x-a8"]?.[1]); // shared, not copied
  });

  it("reports a pure $ref cycle instead of recursing forever", () => {
    const doc = { a: { $ref: "#/b" }, b: { $ref: "#/a" } };
    expect(() => resolveRefs(doc)).toThrow(/circular \$ref chain/);
  });
});

describe("CLI numeric and missing flag values", () => {
  it.each([
    [["--port", "abc"], /--port expects an integer/],
    [["--port", "70000"], /--port expects an integer/],
    [["--port", "80.5"], /--port expects an integer/],
    [["--fail-rate", "2"], /--fail-rate expects a number between 0 and 1/],
    [["--fail-rate", "abc"], /--fail-rate expects/],
    [["--delay", "-5"], /--delay expects/],
    [["--prefer", "abc"], /--prefer expects/],
    [["--spec"], /--spec requires a value/],
    [["--spec", "--strict"], /--spec requires a value/],
  ])("rejects %j", async (argv, message) => {
    const { parseArgs } = await import("../src/cli.js");
    expect(() => parseArgs(argv)).toThrow(message);
  });
});
