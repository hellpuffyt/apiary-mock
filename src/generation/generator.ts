import type { JsonSchema } from "../openapi/types.js";
import { createRng, rngBool, rngFloat, rngInt, rngPick, type Rng } from "./rng.js";
import { generateFromPattern } from "./pattern.js";
import { numericBounds } from "../validation/bounds.js";

export interface GenerateOptions {
  seed?: string | number;
  rng?: Rng;
}

const EMAIL_LOCAL = ["alice", "bob", "carol", "dave", "erin"];
const EMAIL_DOMAIN = ["example.com", "example.org", "example.net"];
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function generateUuid(rng: Rng): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += hex[Math.floor(rng() * 16)];
  }
  return [
    out.slice(0, 8),
    out.slice(8, 12),
    "4" + out.slice(13, 16),
    ((parseInt(out[16] ?? "8", 16) & 0x3) | 0x8).toString(16) + out.slice(17, 20),
    out.slice(20, 32),
  ].join("-");
}

function generateDate(rng: Rng): string {
  const year = rngInt(rng, 2020, 2030);
  const month = rngInt(rng, 1, 12);
  const day = rngInt(rng, 1, 28);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function generateDateTime(rng: Rng): string {
  const date = generateDate(rng);
  const h = pad(rngInt(rng, 0, 23));
  const m = pad(rngInt(rng, 0, 59));
  const s = pad(rngInt(rng, 0, 59));
  return `${date}T${h}:${m}:${s}Z`;
}

function generateStringByFormat(schema: JsonSchema, rng: Rng): string {
  switch (schema.format) {
    case "uuid":
      return generateUuid(rng);
    case "date":
      return generateDate(rng);
    case "date-time":
      return generateDateTime(rng);
    case "email":
      return `${rngPick(rng, EMAIL_LOCAL)}@${rngPick(rng, EMAIL_DOMAIN)}`;
    case "uri":
    case "url":
      return `https://example.com/${rngPick(rng, WORDS)}`;
    case "hostname":
      return `${rngPick(rng, WORDS)}.example.com`;
    case "ipv4":
      return `${rngInt(rng, 1, 254)}.${rngInt(rng, 0, 254)}.${rngInt(rng, 0, 254)}.${rngInt(rng, 1, 254)}`;
    default:
      return plainString(schema, rng);
  }
}

function plainString(schema: JsonSchema, rng: Rng): string {
  const minLength = schema.minLength ?? 0;
  const maxLength = schema.maxLength ?? Math.max(minLength, 8);
  const targetLength = rngInt(rng, minLength, Math.max(minLength, maxLength));
  // Prefer a non-empty string, but never exceed maxLength (maxLength: 0 means "").
  const length = Math.max(minLength, Math.min(maxLength, Math.max(targetLength, 1)));
  let base = rngPick(rng, WORDS);
  while (base.length < length) base += rngPick(rng, WORDS);
  return base.slice(0, length);
}

/** Number of decimal places in `n` (for snapping multiples like 0.1 * 3 to 0.3). */
function decimals(n: number): number {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1] ?? 0);
  return s.includes(".") ? (s.split(".")[1] ?? "").length : 0;
}

/**
 * Generates a number satisfying minimum/maximum (inclusive or exclusive, 3.0 or 3.1 style)
 * and multipleOf. Falls back to the nearest bound if the constraints are unsatisfiable.
 */
function generateNumber(schema: JsonSchema, rng: Rng, integer: boolean): number {
  const b = numericBounds(schema);
  let lo = b.min ?? (b.max !== undefined ? Math.min(0, b.max - 1000) : 0);
  let hi = b.max ?? lo + 1000;
  const step = typeof schema.multipleOf === "number" && schema.multipleOf > 0 ? schema.multipleOf : undefined;

  if (integer || step !== undefined) {
    const unit = step ?? 1;
    // Smallest/largest k with k*unit inside the (possibly exclusive) bounds.
    let kLo = Math.ceil(lo / unit);
    if (b.minExclusive && kLo * unit <= lo) kLo += 1;
    let kHi = Math.floor(hi / unit);
    if (b.maxExclusive && kHi * unit >= hi) kHi -= 1;
    if (integer && step === undefined) {
      kLo = Math.ceil(kLo);
      kHi = Math.floor(kHi);
    }
    if (kHi < kLo) return integer ? Math.ceil(lo) : lo;
    let value = rngInt(rng, kLo, kHi) * unit;
    if (step !== undefined) value = Number(value.toFixed(decimals(step)));
    if (integer && !Number.isInteger(value)) {
      // multipleOf a fraction for an integer: fall back to an integer multiple of 1.
      return Math.ceil(b.minExclusive ? lo + 1e-9 : lo);
    }
    return value;
  }

  if (b.minExclusive || b.maxExclusive) {
    const span = hi - lo;
    const pad = span > 0 ? Math.min(span / 1000, 0.01) : 0;
    if (b.minExclusive) lo += pad;
    if (b.maxExclusive) hi -= pad;
  }
  const raw = rngFloat(rng, lo, hi);
  const rounded = Math.round(raw * 100) / 100;
  const inRange =
    (b.min === undefined || (b.minExclusive ? rounded > b.min : rounded >= b.min)) &&
    (b.max === undefined || (b.maxExclusive ? rounded < b.max : rounded <= b.max));
  return inRange ? rounded : raw;
}

function pickSchema(schemas: JsonSchema[], rng: Rng): JsonSchema {
  return schemas[Math.floor(rng() * schemas.length)] as JsonSchema;
}

function mergeAllOf(schemas: JsonSchema[]): JsonSchema {
  const merged: JsonSchema = { type: "object", properties: {}, required: [] };
  for (const s of schemas) {
    // Copy over any scalar/other keys (format, example, etc.) without disturbing the
    // properties/required accumulators being built up below.
    for (const [key, value] of Object.entries(s)) {
      if (key === "properties" || key === "required") continue;
      merged[key] = value;
    }
    if (s.properties) {
      merged.properties = { ...(merged.properties ?? {}), ...s.properties };
    }
    if (s.required) {
      merged.required = [...new Set([...(merged.required ?? []), ...s.required])];
    }
  }
  return merged;
}

function inferType(schema: JsonSchema): string | undefined {
  if (schema.type) return Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (schema.enum) return typeof schema.enum[0];
  return undefined;
}

/** Generates a value satisfying `schema`, honouring examples first, then constraints. */
export function generateValue(schema: JsonSchema | undefined, options: GenerateOptions = {}): unknown {
  const rng = options.rng ?? createRng(options.seed ?? "apiary-mock");
  return generateFromSchema(schema, rng, new Set());
}

function generateFromSchema(
  schema: JsonSchema | undefined,
  rng: Rng,
  seenRefs: Set<JsonSchema>,
): unknown {
  if (!schema) return null;

  if (schema.example !== undefined) return schema.example;
  if (schema.examples) {
    if (Array.isArray(schema.examples) && schema.examples.length > 0) {
      return schema.examples[0];
    }
    const values = Object.values(schema.examples as Record<string, { value?: unknown }>);
    if (values.length > 0) return values[0]?.value;
  }
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;

  if (schema.oneOf && schema.oneOf.length > 0) {
    return generateFromSchema(pickSchema(schema.oneOf, rng), rng, seenRefs);
  }
  if (schema.anyOf && schema.anyOf.length > 0) {
    return generateFromSchema(pickSchema(schema.anyOf, rng), rng, seenRefs);
  }
  if (schema.allOf && schema.allOf.length > 0) {
    return generateFromSchema(mergeAllOf(schema.allOf), rng, seenRefs);
  }

  if (schema.enum && schema.enum.length > 0) {
    return rngPick(rng, schema.enum);
  }

  // Guard against runaway recursion on circular schemas: after we've expanded a given
  // schema object twice on the current path, bottom out with a minimal value.
  const depth = seenRefs.has(schema) ? 1 : 0;
  if (depth > 0) return null;
  seenRefs = new Set(seenRefs);
  seenRefs.add(schema);

  const type = inferType(schema);

  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const skipped: string[] = [];
      for (const [key, propSchema] of Object.entries(props)) {
        if (required.has(key) || rng() > 0.15) {
          out[key] = generateFromSchema(propSchema, rng, seenRefs);
        } else {
          skipped.push(key);
        }
      }
      // Honour minProperties by adding back optional properties that were skipped.
      const minProps = schema.minProperties ?? 0;
      for (const key of skipped) {
        if (Object.keys(out).length >= minProps) break;
        out[key] = generateFromSchema(props[key], rng, seenRefs);
      }
      return out;
    }
    case "array": {
      const itemSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
      const min = schema.minItems ?? Math.min(1, schema.maxItems ?? 1);
      const max = schema.maxItems ?? Math.max(min, 3);
      const count = rngInt(rng, min, max);
      const arr: unknown[] = [];
      if (schema.uniqueItems) {
        // Draw until `count` distinct items are found (bounded attempts: a small enum may
        // not have enough distinct values, in which case we return what exists).
        const seen = new Set<string>();
        for (let attempt = 0; arr.length < count && attempt < count * 20; attempt++) {
          const item = generateFromSchema(itemSchema, rng, seenRefs);
          const key = JSON.stringify(item);
          if (seen.has(key)) continue;
          seen.add(key);
          arr.push(item);
        }
        return arr;
      }
      for (let i = 0; i < count; i++) {
        arr.push(generateFromSchema(itemSchema, rng, seenRefs));
      }
      return arr;
    }
    case "string": {
      if (schema.pattern) return generateFromPattern(schema.pattern, rng);
      return generateStringByFormat(schema, rng);
    }
    case "integer":
      return generateNumber(schema, rng, true);
    case "number":
      return generateNumber(schema, rng, false);
    case "boolean":
      return rngBool(rng);
    case "null":
      return null;
    default:
      return null;
  }
}
