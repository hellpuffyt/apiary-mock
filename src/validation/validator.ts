import { Ajv } from "ajv";
import addFormatsImport from "ajv-formats";
import type { MountedOperation, OpenApiMediaType } from "../openapi/types.js";
import { toJsonSchema } from "./jsonSchema.js";
import { validateParameters, type ParamSource } from "./params.js";
import { RequestValidationError, type ValidationIssue } from "./errors.js";

// ajv-formats' published .d.ts does not resolve cleanly to its default export under
// NodeNext + a CommonJS dependency; the runtime value is correct, so we cast around the
// type-only mismatch rather than fight the two packages' module formats.
const addFormats = addFormatsImport as unknown as (instance: Ajv) => void;

const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: false });
addFormats(ajv);

const compiledCache = new WeakMap<object, ReturnType<typeof ajv.compile>>();

function compileSchema(schema: Record<string, unknown>): ReturnType<typeof ajv.compile> {
  const cached = compiledCache.get(schema);
  if (cached) return cached;
  const validateFn = ajv.compile(schema);
  compiledCache.set(schema, validateFn);
  return validateFn;
}

export interface RequestToValidate {
  pathParams: Record<string, string>;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  contentType?: string;
  body?: unknown;
  rawBodyPresent: boolean;
}

export interface ValidateOptions {
  strict?: boolean;
}

function selectMediaType(
  content: Record<string, OpenApiMediaType> | undefined,
  contentType: string | undefined,
): { key: string; media: OpenApiMediaType } | undefined {
  if (!content) return undefined;
  const type = (contentType ?? "application/json").split(";")[0]?.trim() ?? "application/json";
  if (content[type]) return { key: type, media: content[type] as OpenApiMediaType };
  if (content["*/*"]) return { key: "*/*", media: content["*/*"] as OpenApiMediaType };
  // application/json is the practical default most specs and clients mean.
  if (type === "application/json" && content["application/json"]) {
    return { key: "application/json", media: content["application/json"] as OpenApiMediaType };
  }
  return undefined;
}

export function validateRequest(
  op: MountedOperation,
  req: RequestToValidate,
  options: ValidateOptions = {},
): void {
  const issues: ValidationIssue[] = [];

  const source: ParamSource = { path: req.pathParams, query: req.query, header: req.headers };
  validateParameters(op.parameters, source, issues);

  if (options.strict) {
    const knownQueryNames = new Set(
      op.parameters.filter((p) => p.in === "query").map((p) => p.name),
    );
    for (const key of Object.keys(req.query)) {
      if (!knownQueryNames.has(key)) {
        issues.push({ location: "query", path: key, message: "is not a defined query parameter" });
      }
    }
  }

  const requestBody = op.operation.requestBody;
  if (requestBody) {
    if (!req.rawBodyPresent) {
      if (requestBody.required) {
        issues.push({ location: "body", path: "$", message: "request body is required" });
      }
    } else {
      const selected = selectMediaType(requestBody.content, req.contentType);
      if (!selected) {
        const supported = Object.keys(requestBody.content ?? {}).join(", ") || "(none defined)";
        issues.push({
          location: "content-type",
          path: "content-type",
          message: `unsupported content-type "${req.contentType ?? ""}"; expected one of: ${supported}`,
        });
      } else if (selected.media.schema) {
        const jsonSchema = toJsonSchema(selected.media.schema);
        if (options.strict && jsonSchema.type === "object" && jsonSchema.additionalProperties === undefined) {
          jsonSchema.additionalProperties = false;
        }
        const validateFn = compileSchema(jsonSchema);
        const valid = validateFn(req.body);
        if (!valid) {
          for (const err of validateFn.errors ?? []) {
            issues.push({
              location: "body",
              path: err.instancePath || "$",
              message: `${err.message ?? "is invalid"}${
                err.params && "allowedValues" in err.params
                  ? ` [${(err.params as { allowedValues: unknown[] }).allowedValues.join(", ")}]`
                  : ""
              }`,
            });
          }
        }
      }
    }
  } else if (req.rawBodyPresent && options.strict) {
    issues.push({
      location: "body",
      path: "$",
      message: "operation does not accept a request body",
    });
  }

  if (issues.length > 0) {
    throw new RequestValidationError(422, issues);
  }
}
