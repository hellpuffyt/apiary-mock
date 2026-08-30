/** Minimal structural types for the slice of OpenAPI 3.0/3.1 this project understands. */

export type JsonSchema = Record<string, unknown> & {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  nullable?: boolean;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string }> | unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  default?: unknown;
};

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: JsonSchema;
  example?: unknown;
  style?: string;
  explode?: boolean;
}

export interface OpenApiMediaType {
  schema?: JsonSchema;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string }>;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
  headers?: Record<string, { schema?: JsonSchema; required?: boolean }>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
}

export type OpenApiPathItem = Partial<
  Record<
    "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace",
    OpenApiOperation
  >
> & {
  parameters?: OpenApiParameter[];
};

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiRequestBody>;
    responses?: Record<string, OpenApiResponse>;
  };
}

export const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A single fully-resolved (path, method) operation, ready to route/validate/generate against. */
export interface MountedOperation {
  method: HttpMethod;
  path: string;
  pathRegex: RegExp;
  pathParamNames: string[];
  operationId?: string;
  operation: OpenApiOperation;
  parameters: OpenApiParameter[];
}
