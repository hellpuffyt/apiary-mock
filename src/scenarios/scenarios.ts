import { readFileSync } from "node:fs";
import { parseSpecSource } from "../openapi/loader.js";

export interface ScenarioMatch {
  method?: string;
  path?: string;
  pathPattern?: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface ScenarioResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
}

export interface Scenario {
  name?: string;
  match: ScenarioMatch;
  response: ScenarioResponse;
}

export interface ScenarioFile {
  scenarios: Scenario[];
}

export function loadScenarios(path: string): Scenario[] {
  const source = readFileSync(path, "utf-8");
  const parsed = parseSpecSource(source, path) as ScenarioFile | Scenario[];
  const scenarios = Array.isArray(parsed) ? parsed : parsed.scenarios;
  if (!Array.isArray(scenarios)) {
    throw new Error(`Scenario file "${path}" must contain a top-level "scenarios" array`);
  }
  return scenarios;
}

export interface IncomingRequest {
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  body?: unknown;
}

function pathMatches(match: ScenarioMatch, req: IncomingRequest): boolean {
  if (match.path !== undefined) return match.path === req.path;
  if (match.pathPattern !== undefined) {
    try {
      return new RegExp(match.pathPattern).test(req.path);
    } catch {
      return false;
    }
  }
  return true;
}

function queryMatches(match: ScenarioMatch, req: IncomingRequest): boolean {
  if (!match.query) return true;
  for (const [key, expected] of Object.entries(match.query)) {
    const actual = req.query[key];
    const actualValue = Array.isArray(actual) ? actual[0] : actual;
    if (String(actualValue ?? "") !== String(expected)) return false;
  }
  return true;
}

/** Deep partial match: every key/value in `expected` must be present and equal in `actual`. */
function bodyMatches(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) return true;
  if (expected === null) return actual === null;
  if (typeof expected !== "object") return expected === actual;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, i) => bodyMatches(item, actual[i]));
  }
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
    bodyMatches(value, (actual as Record<string, unknown>)[key]),
  );
}

/** Specificity score: more constraints declared on a matcher makes it win ties in precedence. */
function specificity(match: ScenarioMatch): number {
  let score = 0;
  if (match.method) score++;
  if (match.path) score += 2;
  if (match.pathPattern) score++;
  if (match.query) score += Object.keys(match.query).length;
  if (match.body !== undefined) score += 2;
  return score;
}

/**
 * Finds the best-matching scenario for an incoming request. Among scenarios that match,
 * the most specific matcher wins; ties are broken by declaration order (first wins).
 */
export function findMatchingScenario(scenarios: Scenario[], req: IncomingRequest): Scenario | undefined {
  let best: Scenario | undefined;
  let bestScore = -1;
  for (const scenario of scenarios) {
    const { match } = scenario;
    if (match.method && match.method.toUpperCase() !== req.method.toUpperCase()) continue;
    if (!pathMatches(match, req)) continue;
    if (!queryMatches(match, req)) continue;
    if (match.body !== undefined && !bodyMatches(match.body, req.body)) continue;

    const score = specificity(match);
    if (score > bestScore) {
      best = scenario;
      bestScore = score;
    }
  }
  return best;
}
