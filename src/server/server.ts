import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { OpenApiDocument, MountedOperation } from "../openapi/types.js";
import { mountOperations } from "../openapi/loader.js";
import { validateRequest } from "../validation/validator.js";
import { RequestValidationError } from "../validation/errors.js";
import { buildResponse } from "./respond.js";
import { matchRoute, findNearbyPaths } from "./router.js";
import { findMatchingScenario, type Scenario } from "../scenarios/scenarios.js";
import { createRng } from "../generation/rng.js";

export interface ServerOptions {
  doc: OpenApiDocument;
  scenarios?: Scenario[];
  strict?: boolean;
  preferStatus?: number;
  delayMs?: number;
  failRate?: number;
  seed?: string;
}

export interface MockServer {
  operations: MountedOperation[];
  handle: (req: IncomingMessage, res: ServerResponse) => void;
  listen: (port: number, host?: string) => Promise<{ port: number; host: string }>;
  close: () => Promise<void>;
  server: ReturnType<typeof createHttpServer>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(payload);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockServer(options: ServerOptions): MockServer {
  const operations = mountOperations(options.doc);
  const scenarios = options.scenarios ?? [];
  let requestCounter = 0;

  async function handleAsync(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    const query: Record<string, string | string[]> = {};
    for (const key of url.searchParams.keys()) {
      const all = url.searchParams.getAll(key);
      query[key] = all.length > 1 ? all : (all[0] ?? "");
    }

    const rawBody = await readBody(req);
    const contentType = req.headers["content-type"];
    const rawBodyPresent = rawBody.length > 0;
    let parsedBody: unknown;
    if (rawBodyPresent) {
      if (!contentType || contentType.includes("json")) {
        try {
          parsedBody = JSON.parse(rawBody.toString("utf-8"));
        } catch {
          sendJson(res, 400, {
            error: "Bad Request",
            status: 400,
            message: "Request body is not valid JSON",
            issues: [{ location: "body", path: "$", message: "malformed JSON" }],
          });
          return;
        }
      } else {
        parsedBody = rawBody.toString("utf-8");
      }
    }

    if (options.delayMs) await delay(options.delayMs);

    if (options.failRate && Math.random() < options.failRate) {
      sendJson(res, 500, {
        error: "Internal Server Error",
        status: 500,
        message: "Injected failure (--fail-rate)",
      });
      return;
    }

    const scenario = findMatchingScenario(scenarios, {
      method,
      path: pathname,
      query,
      body: parsedBody,
    });
    if (scenario) {
      if (scenario.response.delayMs) await delay(scenario.response.delayMs);
      sendJson(res, scenario.response.status, scenario.response.body, scenario.response.headers ?? {});
      return;
    }

    const routeMatch = matchRoute(operations, method, pathname);
    if (!routeMatch) {
      const body: Record<string, unknown> = {
        error: "Not Found",
        status: 404,
        message: `No operation matches ${method} ${pathname}`,
      };
      if (options.strict) {
        body.nearbyPaths = findNearbyPaths(operations, pathname);
      }
      sendJson(res, 404, body);
      return;
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }

    try {
      validateRequest(
        routeMatch.operation,
        {
          pathParams: routeMatch.pathParams,
          query,
          headers,
          contentType,
          body: parsedBody,
          rawBodyPresent,
        },
        { strict: options.strict },
      );
    } catch (err) {
      if (err instanceof RequestValidationError) {
        sendJson(res, err.status, err.toBody());
        return;
      }
      throw err;
    }

    requestCounter += 1;
    const seedBase = options.seed ?? "apiary-mock";
    const rng = createRng(`${seedBase}:${routeMatch.operation.method}:${routeMatch.operation.path}:${requestCounter}`);
    const { status, body, headers: responseHeaders } = buildResponse(
      routeMatch.operation,
      options.preferStatus,
      rng,
    );
    sendJson(res, status, body, responseHeaders);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    handleAsync(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal Server Error", status: 500, message });
      } else {
        res.end();
      }
    });
  }

  const server = createHttpServer(handle);

  return {
    operations,
    handle,
    server,
    listen(port: number, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          const actualPort = typeof address === "object" && address ? address.port : port;
          resolve({ port: actualPort, host });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
