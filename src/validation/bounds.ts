import type { JsonSchema } from "../openapi/types.js";

/** Numeric bounds of a schema, normalised across OpenAPI 3.0 and 3.1 / JSON Schema styles. */
export interface NumericBounds {
  min?: number;
  max?: number;
  minExclusive: boolean;
  maxExclusive: boolean;
}

/**
 * OpenAPI 3.0 writes exclusive bounds as `minimum: 5, exclusiveMinimum: true`; OpenAPI 3.1
 * (JSON Schema 2019-09+) writes `exclusiveMinimum: 5`. Both are accepted here.
 */
export function numericBounds(schema: JsonSchema): NumericBounds {
  const bounds: NumericBounds = { minExclusive: false, maxExclusive: false };
  if (typeof schema.minimum === "number") bounds.min = schema.minimum;
  if (typeof schema.maximum === "number") bounds.max = schema.maximum;
  if (schema.exclusiveMinimum === true && bounds.min !== undefined) bounds.minExclusive = true;
  if (schema.exclusiveMaximum === true && bounds.max !== undefined) bounds.maxExclusive = true;
  if (typeof schema.exclusiveMinimum === "number") {
    if (bounds.min === undefined || schema.exclusiveMinimum >= bounds.min) {
      bounds.min = schema.exclusiveMinimum;
      bounds.minExclusive = true;
    }
  }
  if (typeof schema.exclusiveMaximum === "number") {
    if (bounds.max === undefined || schema.exclusiveMaximum <= bounds.max) {
      bounds.max = schema.exclusiveMaximum;
      bounds.maxExclusive = true;
    }
  }
  return bounds;
}

/** Returns a human-readable violation for `value`, or undefined if it satisfies the bounds/multipleOf. */
export function numericViolation(value: number, schema: JsonSchema): string | undefined {
  const b = numericBounds(schema);
  if (b.min !== undefined && (b.minExclusive ? value <= b.min : value < b.min)) {
    return `must be ${b.minExclusive ? ">" : ">="} ${b.min}, got ${value}`;
  }
  if (b.max !== undefined && (b.maxExclusive ? value >= b.max : value > b.max)) {
    return `must be ${b.maxExclusive ? "<" : "<="} ${b.max}, got ${value}`;
  }
  const m = schema.multipleOf;
  if (typeof m === "number" && m > 0) {
    const q = value / m;
    if (Math.abs(q - Math.round(q)) > 1e-9) return `must be a multiple of ${m}, got ${value}`;
  }
  return undefined;
}
