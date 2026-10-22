import { readFileSync } from "node:fs";
import { extname } from "node:path";
import * as yaml from "js-yaml";
import { resolveRefs } from "./refs.js";
import {
  HTTP_METHODS,
  type HttpMethod,
  type MountedOperation,
  type OpenApiDocument,
  type OpenApiParameter,
} from "./types.js";

export function parseSpecSource(source: string, filePath: string): unknown {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".json") return JSON.parse(source);
  if (ext === ".yaml" || ext === ".yml") return yaml.load(source);
  // Fall back to sniffing content when the extension is ambiguous.
  const trimmed = source.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(source);
  return yaml.load(source);
}

export function loadSpecFromString(source: string, filePath = "spec.yaml"): OpenApiDocument {
  const parsed = parseSpecSource(source, filePath);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAPI document did not parse to an object");
  }
  const resolved = resolveRefs<OpenApiDocument>(parsed);
  if (!resolved.openapi || !resolved.paths) {
    throw new Error('Document is missing required "openapi" or "paths" fields');
  }
  const problems = checkDocumentShape(resolved);
  if (problems.length > 0) {
    throw new Error(`Invalid OpenAPI document:\n  - ${problems.join("\n  - ")}`);
  }
  return resolved;
}

const PARAMETER_LOCATIONS = new Set(["path", "query", "header", "cookie"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Structural checks for what the server relies on. Without them a malformed document loaded
 * "successfully" and then failed on every request with a 500 (e.g. an operation without
 * `responses`), or silently mounted nothing (e.g. `paths` given as a list).
 */
export function checkDocumentShape(doc: OpenApiDocument): string[] {
  const problems: string[] = [];
  const version: unknown = doc.openapi;
  if (typeof version !== "string") {
    problems.push(
      `"openapi" must be a string such as "3.0.3" or "3.1.0" (got ${JSON.stringify(version)}; quote it in YAML)`,
    );
  } else if (!/^3\.[01](\.\d+)?(-[0-9A-Za-z.-]+)?$/.test(version)) {
    problems.push(`unsupported "openapi" version "${version}": apiary-mock supports 3.0.x and 3.1.x`);
  }
  if (!isPlainObject(doc.paths)) {
    problems.push('"paths" must be an object keyed by path templates');
    return problems;
  }
  for (const [pathTemplate, pathItem] of Object.entries(doc.paths)) {
    if (!pathTemplate.startsWith("/")) problems.push(`path "${pathTemplate}" must start with "/"`);
    if (pathItem === null || pathItem === undefined) continue;
    if (!isPlainObject(pathItem)) {
      problems.push(`path "${pathTemplate}" must be an object`);
      continue;
    }
    const where = (method: string): string => `${method.toUpperCase()} ${pathTemplate}`;
    checkParameters(pathItem.parameters, `path "${pathTemplate}"`, problems);
    for (const method of HTTP_METHODS) {
      const op: unknown = pathItem[method];
      if (op === undefined) continue;
      if (!isPlainObject(op)) {
        problems.push(`${where(method)}: operation must be an object`);
        continue;
      }
      if (!isPlainObject(op.responses) || Object.keys(op.responses).length === 0) {
        problems.push(`${where(method)}: "responses" must be a non-empty object`);
      }
      checkParameters(op.parameters, where(method), problems);
    }
  }
  return problems;
}

function checkParameters(params: unknown, where: string, problems: string[]): void {
  if (params === undefined) return;
  if (!Array.isArray(params)) {
    problems.push(`${where}: "parameters" must be an array`);
    return;
  }
  params.forEach((param: unknown, i) => {
    if (!isPlainObject(param) || typeof param.name !== "string" || typeof param.in !== "string") {
      problems.push(`${where}: parameter #${i} needs a string "name" and "in"`);
    } else if (!PARAMETER_LOCATIONS.has(param.in)) {
      problems.push(`${where}: parameter "${param.name}" has invalid "in": "${param.in}"`);
    }
  });
}

export function loadSpec(path: string): OpenApiDocument {
  const source = readFileSync(path, "utf-8");
  return loadSpecFromString(source, path);
}

/** Converts an OpenAPI path template ("/pets/{petId}") into a matching RegExp plus param names. */
export function compilePathTemplate(pathTemplate: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = pathTemplate
    .split("/")
    .map((segment) => {
      const match = /^\{(.+)\}$/.exec(segment);
      if (match) {
        paramNames.push(match[1] as string);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}$`), paramNames };
}

/** Flattens an OpenAPI document into a list of routable operations. */
export function mountOperations(doc: OpenApiDocument): MountedOperation[] {
  const mounted: MountedOperation[] = [];
  for (const [pathTemplate, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem) continue;
    const sharedParams = (pathItem.parameters ?? []) as OpenApiParameter[];
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const { regex, paramNames } = compilePathTemplate(pathTemplate);
      const ownParams = (operation.parameters ?? []) as OpenApiParameter[];
      const mergedParams = mergeParameters(sharedParams, ownParams);
      mounted.push({
        method: method as HttpMethod,
        path: pathTemplate,
        pathRegex: regex,
        pathParamNames: paramNames,
        operationId: operation.operationId,
        operation,
        parameters: mergedParams,
      });
    }
  }
  return mounted;
}

function mergeParameters(
  shared: OpenApiParameter[],
  own: OpenApiParameter[],
): OpenApiParameter[] {
  const merged = new Map<string, OpenApiParameter>();
  for (const p of shared) merged.set(`${p.in}:${p.name}`, p);
  for (const p of own) merged.set(`${p.in}:${p.name}`, p);
  return [...merged.values()];
}
