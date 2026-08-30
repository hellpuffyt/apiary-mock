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
  return resolved;
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
