#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadSpec } from "./openapi/loader.js";
import { loadScenarios } from "./scenarios/scenarios.js";
import { createMockServer } from "./server/server.js";
import { formatStartupSummary } from "./server/summary.js";

interface CliOptions {
  spec?: string;
  scenarios?: string;
  port: number;
  host: string;
  strict: boolean;
  prefer?: number;
  delay: number;
  failRate: number;
  seed: string;
  help: boolean;
}

const USAGE = `apiary-mock — a strict OpenAPI mock server

Usage:
  apiary-mock --spec <path> [options]

Options:
  --spec <path>        Path to an OpenAPI 3.0/3.1 document (YAML or JSON). Required.
  --scenarios <path>   Path to a scenarios file (YAML or JSON) for canned responses.
  --port <n>           Port to listen on (default: 4010).
  --host <host>        Host to bind to (default: 127.0.0.1).
  --strict             404 unmatched requests with nearby-path suggestions and reject
                        undeclared query params / extra body properties.
  --prefer <status>    Prefer this response status code when an operation has several.
  --delay <ms>         Add artificial latency (in ms) to every response.
  --fail-rate <0..1>   Fraction of requests to fail with a 500, for resilience testing.
  --seed <string>      Seed for deterministic response generation (default: "apiary-mock").
  -h, --help           Show this help text.
`;

function numberFlag(
  flag: string,
  raw: string | undefined,
  check: { integer?: boolean; min: number; max: number },
): number {
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || (check.integer && !Number.isInteger(value)) || value < check.min || value > check.max) {
    throw new Error(
      `${flag} expects ${check.integer ? "an integer" : "a number"} between ${check.min} and ${check.max}, got ${JSON.stringify(raw ?? "")}`,
    );
  }
  return value;
}

function stringFlag(flag: string, raw: string | undefined): string {
  if (raw === undefined || raw.startsWith("--")) throw new Error(`${flag} requires a value`);
  return raw;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    port: 4010,
    host: "127.0.0.1",
    strict: false,
    delay: 0,
    failRate: 0,
    seed: "apiary-mock",
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--spec":
        options.spec = stringFlag(arg, argv[++i]);
        break;
      case "--scenarios":
        options.scenarios = stringFlag(arg, argv[++i]);
        break;
      case "--port":
        options.port = numberFlag(arg, argv[++i], { integer: true, min: 0, max: 65535 });
        break;
      case "--host":
        options.host = stringFlag(arg, argv[++i]);
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--prefer":
        options.prefer = numberFlag(arg, argv[++i], { integer: true, min: 100, max: 599 });
        break;
      case "--delay":
        options.delay = numberFlag(arg, argv[++i], { min: 0, max: 600_000 });
        break;
      case "--fail-rate":
        options.failRate = numberFlag(arg, argv[++i], { min: 0, max: 1 });
        break;
      case "--seed":
        options.seed = stringFlag(arg, argv[++i]);
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (!options.spec) {
    process.stderr.write("Error: --spec <path> is required\n\n");
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const doc = loadSpec(options.spec);
  const scenarios = options.scenarios ? loadScenarios(options.scenarios) : [];

  const mock = createMockServer({
    doc,
    scenarios,
    strict: options.strict,
    preferStatus: options.prefer,
    delayMs: options.delay,
    failRate: options.failRate,
    seed: options.seed,
  });

  const address = await mock.listen(options.port, options.host);
  process.stdout.write(formatStartupSummary(mock.operations, doc.info, address) + "\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    // Configuration/usage errors read better without a stack trace.
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
