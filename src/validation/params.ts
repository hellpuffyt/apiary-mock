import type { JsonSchema, OpenApiParameter } from "../openapi/types.js";
import type { ValidationIssue } from "./errors.js";

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParamLocation = "path" | "query" | "header";

/** Splits a raw parameter value into an array according to (a simplified) style/explode. */
function splitArrayValues(raw: string | string[], param: OpenApiParameter): string[] {
  if (Array.isArray(raw)) return raw;
  if (param.explode === false || param.style === "form" || param.in !== "query") {
    return raw.split(",");
  }
  return raw.split(",");
}

function coerceAndValidate(
  rawValue: string,
  schema: JsonSchema,
  location: ParamLocation,
  name: string,
  issues: ValidationIssue[],
): unknown {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  let value: unknown = rawValue;

  switch (type) {
    case "integer": {
      if (!/^-?\d+$/.test(rawValue)) {
        issues.push({ location, path: name, message: `expected an integer, got "${rawValue}"` });
        return undefined;
      }
      value = Number(rawValue);
      break;
    }
    case "number": {
      if (rawValue === "" || Number.isNaN(Number(rawValue))) {
        issues.push({ location, path: name, message: `expected a number, got "${rawValue}"` });
        return undefined;
      }
      value = Number(rawValue);
      break;
    }
    case "boolean": {
      if (rawValue !== "true" && rawValue !== "false") {
        issues.push({ location, path: name, message: `expected "true" or "false", got "${rawValue}"` });
        return undefined;
      }
      value = rawValue === "true";
      break;
    }
    case "array":
      // handled by caller
      break;
    default:
      value = rawValue;
  }

  if (typeof value === "number" || type === "integer" || type === "number") {
    const num = value as number;
    if (schema.minimum !== undefined && num < schema.minimum) {
      issues.push({ location, path: name, message: `must be >= ${schema.minimum}, got ${num}` });
    }
    if (schema.maximum !== undefined && num > schema.maximum) {
      issues.push({ location, path: name, message: `must be <= ${schema.maximum}, got ${num}` });
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({
        location,
        path: name,
        message: `must have length >= ${schema.minLength}, got ${value.length}`,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({
        location,
        path: name,
        message: `must have length <= ${schema.maxLength}, got ${value.length}`,
      });
    }
    if (schema.pattern !== undefined) {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          issues.push({ location, path: name, message: `does not match pattern ${schema.pattern}` });
        }
      } catch {
        // malformed pattern in the spec itself — nothing to validate.
      }
    }
    if (schema.format === "date-time" && !DATE_TIME_RE.test(value)) {
      issues.push({ location, path: name, message: `must be a valid date-time, got "${value}"` });
    }
    if (schema.format === "date" && !DATE_RE.test(value)) {
      issues.push({ location, path: name, message: `must be a valid date, got "${value}"` });
    }
    if (schema.format === "uuid" && !UUID_RE.test(value)) {
      issues.push({ location, path: name, message: `must be a valid uuid, got "${value}"` });
    }
    if (schema.format === "email" && !EMAIL_RE.test(value)) {
      issues.push({ location, path: name, message: `must be a valid email, got "${value}"` });
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    issues.push({
      location,
      path: name,
      message: `must be one of [${schema.enum.map(String).join(", ")}], got "${rawValue}"`,
    });
  }

  return value;
}

export interface ParamSource {
  path: Record<string, string>;
  query: Record<string, string | string[]>;
  header: Record<string, string>;
}

export function validateParameters(
  parameters: OpenApiParameter[],
  source: ParamSource,
  issues: ValidationIssue[],
): void {
  for (const param of parameters) {
    const location = param.in as ParamLocation;
    if (location !== "path" && location !== "query" && location !== "header") continue;

    const bucket = source[location];
    const key = location === "header" ? param.name.toLowerCase() : param.name;
    const lookup =
      location === "header"
        ? Object.fromEntries(Object.entries(bucket).map(([k, v]) => [k.toLowerCase(), v]))
        : bucket;
    const raw = lookup[key];

    const required = param.required ?? location === "path";
    if (raw === undefined || raw === "") {
      if (required) {
        issues.push({ location, path: param.name, message: "is required but was not provided" });
      }
      continue;
    }

    const schema = param.schema;
    if (!schema) continue;

    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    if (type === "array") {
      const items = splitArrayValues(raw, param);
      const itemSchema = schema.items as JsonSchema | undefined;
      if (schema.minItems !== undefined && items.length < schema.minItems) {
        issues.push({
          location,
          path: param.name,
          message: `must have at least ${schema.minItems} item(s)`,
        });
      }
      if (schema.maxItems !== undefined && items.length > schema.maxItems) {
        issues.push({
          location,
          path: param.name,
          message: `must have at most ${schema.maxItems} item(s)`,
        });
      }
      if (itemSchema) {
        for (const item of items) {
          coerceAndValidate(item, itemSchema, location, param.name, issues);
        }
      }
      continue;
    }

    coerceAndValidate(Array.isArray(raw) ? (raw[0] ?? "") : raw, schema, location, param.name, issues);
  }
}
