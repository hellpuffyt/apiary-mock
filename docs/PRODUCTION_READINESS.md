# Production readiness — apiary-mock

Audit of the `audit/production-readiness` branch. This document records evidence;
it does not award a production-ready label.

## Scope and architecture

A local OpenAPI 3.0/3.1 mock server (`node:http`): loads a YAML/JSON document, resolves local
`$ref`s, mounts every operation, validates incoming requests (parameters by hand, bodies with
ajv), serves scenario fixtures or schema-generated responses. Runtime deps: `ajv`,
`ajv-formats`, `js-yaml`. See the README "Architecture" section for the module map.

## Platforms and prerequisites

- Node.js >= 20 (`engines`). Verified locally on macOS (Apple Silicon): full gate on Node 24.19.0;
  test suite on Node 20 and 22 (via `npx -p node@<v>`).
- CI matrix (default branch): ubuntu / windows / macOS x Node 20 / 22 / 24. Windows was not run
  locally; one new test (symlinked bin) is skipped on Windows because creating symlinks there needs
  extra privileges.

## Clean-clone setup (as in the README)

```bash
git clone <this-repo> && cd apiary-mock
npm install
npm run build
npx apiary-mock --spec ./examples/petstore.yaml
```

Result on the audit branch (fresh clone into a temporary directory, HEAD before this document):
`npm install` 0, `npm run build` 0, `npm test` 184 passed / 0 failed / 0 skipped, `npx tsc --noEmit` 0,
`npx eslint .` 0 (17 pre-existing `no-explicit-any` warnings in tests). `npx apiary-mock --spec ...`
printed the startup summary and `GET /pets` returned 200. The README "Examples" commands returned
200 / 422 / 201 / 200 (scenario fixture) as documented.

## Commands executed (CI-equivalent, local)

| Command | Baseline (main @ ab91a32) | Audit branch |
|---|---|---|
| `npm ci` | 0 | 0 |
| `npx eslint .` | 0 (17 warnings) | 0 (17 warnings) |
| `npx tsc --noEmit` | 0 | 0 |
| `npm test` | 0 — 131 passed, 0 failed, 0 skipped | 0 — 184 passed, 0 failed, 0 skipped (Node 24, 20, 22) |
| `npm run build` | 0 | 0 |
| CI smoke script (built CLI, valid 2xx + invalid 4xx) | pass | pass |
| `npx --no-install apiary-mock --help` | **no output, exit 0 (bug)** | prints usage |
| `npm audit --omit=dev` | 1 high (`fast-uri` via ajv) | 0 |
| `npm audit` (incl. dev) | 6 (4 high, 2 moderate) | 0 |

## Bugs fixed (regression tests in `test/audit-regressions.test.ts`)

22 of the new tests fail against the baseline source; the alias-bomb test exhausted the heap and
crashed the baseline test worker (the same document reproduced a 4 GB out-of-memory abort in a
standalone run).

| Bug | Impact | Fix |
|---|---|---|
| CLI entry check compared `import.meta.url` to an unresolved `argv[1]` | `npx apiary-mock`, `.bin`, `npm link`, global installs exited 0 doing nothing — the README quick start did not work | resolve symlinks (`isEntryPoint`), CI smoke runs the bin |
| Path decoded twice (whole path, then each param) | `/files/100%25` -> 500; `%2F` split a parameter | decode per segment once |
| Malformed percent-encoding | 500 | 400 |
| OpenAPI 3.0 `exclusiveMinimum: true` passed to ajv | ajv refused the schema: every request to the operation -> 500 | converted to numeric form; params honour exclusive bounds / `multipleOf` |
| ajv `multipleOf` without precision | `0.3` rejected for `multipleOf: 0.1` (422 false positive) | `multipleOfPrecision: 9` |
| `Number()` for number params | `" "`, `0x10`, `Infinity` accepted | JSON-number regex |
| Generator ignored bounds style / `multipleOf` / `maxLength: 0` / `maxItems: 0` / `uniqueItems` / `minProperties`; `maximum` without `minimum` | schema-invalid mock responses (e.g. `0` for `maximum: -5`) | generator fixed; outputs checked by an independent ajv over 200 seeds each, and all petstore responses over 100 seeds |
| Structurally invalid specs loaded | unsupported versions accepted; operations without `responses` -> 500 per request; `paths: []` mounted nothing silently | `checkDocumentShape` with a problem list |
| CLI `Number()` flags | `--port abc` -> stack trace; `--fail-rate 2` accepted | range-checked |

## Security review

| Area | Finding | Severity | Status |
|---|---|---|---|
| Resource exhaustion (spec) | YAML alias bomb (~1 KB) deep-copied by `$ref` resolution -> heap exhaustion | Medium (specs are documented as trusted, but this is a trivial crash) | Fixed: identity memoisation |
| Resource exhaustion (requests) | Request bodies buffered without limit | Medium | Fixed: 10 MiB cap, 413 |
| Prototype walk | `$ref: "#/__proto__"` resolved to `Object.prototype` | Low | Fixed: own properties only |
| Deserialization | js-yaml default schema rejects `!!js/*` tags | Info | Verified (test) |
| ReDoS | Spec `pattern`s run against request input | Low (trusted spec) | Documented |
| Network exposure | Binds `127.0.0.1` by default | Info | Verified |
| Dependencies | `fast-uri` high (runtime, via ajv) + dev advisories | High (runtime, URI parsing helpers) | Fixed via `npm audit fix` (lockfile only) |
| Workflow permissions | none declared | Low | `contents: read` added |
| Secrets in tree/history | 2 commits scanned, no hits | Info | none |

## Acceptance checklist

| Item | Expected behaviour | Command / test | Result | Reference |
|---|---|---|---|---|
| Load 3.0/3.1 YAML/JSON with local, nested and circular `$ref`s | loads; cycles close by identity | `test/refs.test.ts`, `test/loader.test.ts` | pass | `src/openapi/refs.ts` |
| Reject invalid specs | clear load-time error listing problems | `audit-regressions` "invalid and hostile specs" | pass | `checkDocumentShape` |
| Request param validation | type/format/required/enum/bounds/length/pattern; no false positives | `test/params.test.ts`, `test/validator.test.ts`, audit tests | pass | `src/validation/params.ts` |
| Body validation | ajv incl. 3.0 `nullable` and exclusive bounds; content-type negotiation | `test/validator.test.ts`, audit tests | pass | `validator.ts`, `jsonSchema.ts` |
| Response correctness | generated bodies validate against declared schemas | audit "generated values satisfy their schema" | pass | `generator.ts` |
| Determinism | same seed -> same output | `test/generator.test.ts` | pass | `rng.ts` |
| Scenarios | precedence, deep partial body match | `test/scenarios.test.ts`, smoke | pass | `scenarios.ts` |
| `--strict` | nearby paths, undeclared query/body rejected | `test/server.test.ts` | pass | `server.ts` |
| Robust request handling | malformed path 400, huge body 413, `%25` handled | audit "request paths" | pass | `server.ts`, `router.ts` |
| Installed CLI works | bin via symlink runs | audit "CLI entry point", CI smoke, clean clone | pass | `src/cli.ts` |

## CI status

- Default branch (`main` @ ab91a32): last run `success`.
- Audit branch: pending until pushed.

## Limitations and unresolved risks

See README "Limitations": local `$ref`s only, best-effort `pattern` generation, recursive schemas
to one level (a *required* non-nullable recursive property is generated as `null`), simplified
`style`/`explode`, no `discriminator`, structural (not full meta-schema) spec validation. A
malicious spec can still make generation or ajv compilation expensive; specs must be trusted.

## Tested commit

Code under test: `e441e3d` (README-only change on top of the clean-cloned `d5f3780`), 2026-10-22.

## Classification proposal

**Partially Verified** — documented features work and are tested locally on macOS with Node 20/22/24
and in a clean clone; CI on the audit branch (including Windows) has not run yet.
