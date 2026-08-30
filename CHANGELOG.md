# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
