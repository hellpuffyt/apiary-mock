# apiary-mock

A mock API server driven entirely by an OpenAPI 3.0/3.1 document — one that
validates every request against the spec before it answers, the same way the
real API would.

## What

`apiary-mock` reads an OpenAPI document, mounts every declared operation, and
serves it over plain HTTP. Unlike most mock servers, it does not just echo
back a canned shape for any request you throw at it: it validates the
request — path/query/header parameters and the request body — against the
spec first, and rejects anything the real API would reject, with an error
shaped like the real API's error would be. Responses it *does* generate are
built from the operation's response schema, honoring `example`s where the
spec provides them and otherwise synthesizing values that satisfy the
schema's constraints deterministically.

## Why

Frontend and integration work routinely blocks on a backend that doesn't
exist yet. The common fix — a mock server — usually accepts anything: wrong
content type, a missing required field, an out-of-range enum value, a
malformed path parameter. You build against that fiction, and only discover
the gap when you integrate against the real thing. apiary-mock is strict
where the real API is strict, so the contract you build against during
development is the contract you'll actually get in production.

## Features

- **OpenAPI 3.0/3.1 loading** from YAML or JSON, with local `$ref` resolution
  — including refs nested several levels deep and circular schemas (e.g. a
  `Category` that references its own `parent`).
- **Request validation**: path, query, and header parameters (type, format,
  required, enum, numeric bounds, string length, pattern) and the request
  body against its JSON Schema (via [ajv](https://ajv.js.org)), including
  content-type negotiation. Violations come back as a 422/400 with a
  `spec`-shaped error body listing every issue found.
- **Schema-driven response generation**: uses a declared `example`/`examples`
  when present; otherwise synthesizes a value honoring `type`, `format`
  (`date-time`, `date`, `uuid`, `email`, `uri`, `hostname`, `ipv4`), `enum`,
  `minimum`/`maximum`, `minLength`/`maxLength`, `pattern` (best-effort regex
  generation), `required`, and nested objects/arrays — deterministically,
  under `--seed`.
- **Scenario replay**: point `--scenarios` at a file mapping request matchers
  (method/path/query/body predicate) to canned responses, so you can force a
  409, a specific error payload, or an empty page on demand.
- **Status code selection**: `--prefer 201` picks a specific declared
  response; otherwise the lowest 2xx wins.
- **`--strict` mode**: 404s for unmatched routes come with a list of the
  nearest known paths, undeclared query parameters are rejected, and a body
  sent to an operation that doesn't accept one is rejected too.
- **Resilience testing**: `--delay` adds artificial latency to every
  response; `--fail-rate` randomly injects 500s.
- **Startup summary**: prints every mounted method + path (+ operationId) so
  you can see at a glance what's being served.

## Architecture

```
src/
  openapi/     document loading (YAML/JSON), $ref resolution, path-template
               compilation, and flattening the doc into MountedOperations
  validation/  parameter validation + ajv-backed request body validation,
               plus an OpenAPI -> plain-JSON-Schema converter (nullable, and
               circular-schema cycle-breaking so ajv can compile it)
  generation/  seeded PRNG, a best-effort regex -> string generator for
               `pattern`, and the schema -> value generator itself
  scenarios/   scenario file loading and request matching
  server/      routing, response selection, the node:http server, and the
               startup summary printer
  cli.ts       argument parsing and the executable entry point
  index.ts     library entry point re-exporting the pieces above
```

Requests flow: parse method/path/query/body → check scenarios (first,
highest-specificity match wins) → if no scenario, route to an operation (404
if none, with nearby-path hints in `--strict`) → validate the request against
that operation (422 on violation) → apply `--delay`/`--fail-rate` → generate
and return a response.

## Installation

```bash
npm install
npm run build
```

Requires Node.js 20+.

## Usage

```bash
npx apiary-mock --spec ./examples/petstore.yaml
```

```
Usage:
  apiary-mock --spec <path> [options]

Options:
  --spec <path>        Path to an OpenAPI 3.0/3.1 document (YAML or JSON). Required.
  --scenarios <path>   Path to a scenarios file (YAML or JSON) for canned responses.
  --port <n>           Port to listen on (default: 4010).
  --host <host>        Host to bind to (default: 127.0.0.1).
  --strict             404 unmatched requests with nearby-path suggestions and reject
                        undeclared query params / extra body properties.
  --prefer <status>    Prefer this response status code when an operation has several.
  --delay <ms>         Add artificial latency (in ms) to every response.
  --fail-rate <0..1>   Fraction of requests to fail with a 500, for resilience testing.
  --seed <string>      Seed for deterministic response generation (default: "apiary-mock").
  -h, --help           Show this help text.
```

On startup it prints what it mounted:

```
apiary-mock — Petary — Example Pet Store API (1.0.0)
listening on http://127.0.0.1:4010

mounted 4 operation(s):
  DELETE  /pets/{petId}  (deletePet)
  GET     /pets  (listPets)
  GET     /pets/{petId}  (getPet)
  POST    /pets  (createPet)
```

## Scenarios format

A scenarios file is a YAML or JSON document with a top-level `scenarios`
array. Each entry has a `match` and a `response`:

```yaml
scenarios:
  - name: force a conflict when creating a pet named "Duplicate"
    match:
      method: POST
      path: /pets
      body:
        name: Duplicate          # partial/deep match — only these keys are checked
    response:
      status: 409
      headers:
        content-type: application/json
      body:
        message: A pet named "Duplicate" already exists
        code: CONFLICT

  - name: filtering by sold status returns an empty page
    match:
      method: GET
      path: /pets
      query:
        status: sold
    response:
      status: 200
      body:
        items: []
        total: 0
```

`match` supports `method`, `path` (exact) or `pathPattern` (regex), `query`
(exact key/value match), and `body` (a deep partial match — every key in the
matcher must be present and equal in the actual body; extra keys in the
actual body are ignored). When more than one scenario matches, the more
specific matcher wins (more declared fields = more specific); ties are
broken by declaration order. A matched scenario is served as-is, skipping
normal request validation — that's the point: it lets you force responses
the spec wouldn't otherwise produce.

## Examples

The `examples/` directory has a runnable pet store spec and scenario file:

```bash
node dist/cli.js --spec examples/petstore.yaml --scenarios examples/scenarios.yaml --strict

curl http://127.0.0.1:4010/pets
curl "http://127.0.0.1:4010/pets?status=bogus"        # 422 — not a valid enum value
curl -X POST http://127.0.0.1:4010/pets \
  -H "content-type: application/json" \
  -d '{"name":"Rex","category":{"id":1,"name":"Dogs"}}' # 201, schema-generated body
curl http://127.0.0.1:4010/pets/11111111-1111-1111-1111-111111111111  # scenario fixture
```

## Testing

```bash
npm test          # vitest
npx tsc --noEmit  # typecheck (src + test)
npx eslint .       # lint
```

The suite (131 tests across 12 files) covers `$ref` resolution (including
nested and circular schemas), request validation for every violation class
*and* valid-request false-positive guards, schema-driven generation and its
constraints, determinism under a fixed seed, scenario matching precedence,
strict mode, and the server exercised over real HTTP on an ephemeral port.

## Limitations

- Only local `$ref`s (`#/...`) are supported — no external file or URL refs.
- `pattern` generation is best-effort: it covers literals, character
  classes, `\d \w \s` shorthands (and negations), groups, alternation, and
  the common quantifiers. Lookaround and backreferences aren't supported and
  fall back to a generic string.
- Recursive schemas (e.g. `Category.parent -> Category`) are generated and
  validated to one level of depth; beyond that, generation stops descending
  and validation permits anything, to avoid infinite structures.
- OpenAPI parameter `style`/`explode` handling is simplified: array-valued
  query parameters are read either as repeated `?a=1&a=2` or a single
  comma-separated value.
- `oneOf`/`anyOf` request bodies are validated with ajv's standard
  (non-discriminated) semantics; no `discriminator` shortcut is implemented.

## Security

apiary-mock is a development tool. It executes no code from the OpenAPI
document or scenario files beyond parsing YAML/JSON, evaluating declared
`pattern`/`pathPattern` values as regular expressions (from files you point
it at), and returning declared/generated data. Do not point it at untrusted
specs or scenario files, and do not expose it on a public network — it is
meant to run on `127.0.0.1` during local development or CI.

## License

MIT © 2026 Prabesh Sharma. See [LICENSE](./LICENSE).
