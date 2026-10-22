# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Path parameters were percent-decoded twice: `/files/100%25` returned a 500
  and `%2F` split a parameter into two segments. Each segment is now decoded once.
- Malformed percent-encoding in the request path returns `400` instead of `500`.
- OpenAPI 3.0 boolean `exclusiveMinimum`/`exclusiveMaximum` made ajv reject the
  schema, so every request to that operation failed with a 500; they are now
  converted to the numeric form, and parameter validation honours exclusive
  bounds and `multipleOf`.
- Request bodies such as `0.3` for `multipleOf: 0.1` were rejected by float
  rounding (ajv `multipleOfPrecision` is now set).
- Number parameters accepted `" "`, `0x10` and `Infinity`; they are now parsed
  as JSON numbers.
- Response generation now satisfies `maximum` without `minimum` (negative
  ranges), exclusive bounds (3.0 and 3.1 styles), `multipleOf`, `maxLength: 0`,
  `maxItems: 0`, `uniqueItems` and `minProperties`.
- Structurally invalid documents (unsupported or unquoted `openapi` version,
  `paths` not an object, operations without `responses`, bad parameter `in`)
  are rejected at load time with a list of problems instead of loading and then
  failing per request.
- CLI: numeric flags are range-checked (`--port abc` used to crash with a
  stack trace) and flags that need a value report when it is missing.

### Security

- YAML aliases are no longer deep-copied during `$ref` resolution; a ~1 KB
  alias-bomb document previously exhausted the heap.
- `$ref` pointers only follow own properties (`#/__proto__` no longer resolves).
- Request bodies are capped at 10 MiB (`413`), configurable via `maxBodyBytes`.
- Runtime dependency `fast-uri` (via ajv) and dev dependencies updated with
  `npm audit fix` (GHSA-qw65-cvwx-89v3, GHSA-58mr-gqgx-xq4g, GHSA-hrr3-gc8f-f4qj).
- CI workflow runs with `permissions: contents: read`.

## [1.0.0] - 2026-08-30

### Added

- OpenAPI 3.0/3.1 loader for YAML and JSON documents, with local `$ref` resolution
  (nested and circular-safe).
- Request validation against the matched operation: path/query/header parameters
  (type, format, required, enum, min/max, length, pattern) and request body against
  its JSON Schema via ajv, including content-type negotiation.
- Schema-driven response generation honouring `example`/`examples` first, then
  `type`, `format` (`date-time`, `date`, `uuid`, `email`, `uri`, `hostname`, `ipv4`),
  `enum`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern` (best-effort regex
  generator), `required`, and nested objects/arrays. Deterministic under `--seed`.
- Scenario replay: match requests by method/path/query/body predicate and return a
  canned status, headers, and body.
- Status code selection via `--prefer`, defaulting to the lowest declared 2xx.
- `--strict` mode: 404 with nearby-path suggestions for unmatched routes, and
  rejection of undeclared query parameters / unexpected request bodies.
- `--delay` for artificial latency and `--fail-rate` for injected 500s, for
  resilience testing.
- Startup summary printing every mounted operation.
- CLI (`apiary-mock`) and a small library API (`src/index.ts`).
