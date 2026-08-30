# Contributing

Thanks for considering a contribution to apiary-mock.

## Development setup

```bash
npm install
npm run build
npm test
```

Requires Node.js 20 or newer.

## Workflow

1. Fork and branch from `main`.
2. Make your change with tests. New behavior needs new tests; bug fixes should
   include a regression test that fails before the fix and passes after.
3. Before opening a pull request, run all of the gates locally:
   ```bash
   npm test
   npx tsc --noEmit
   npx eslint .
   npm run build
   ```
4. Keep commits focused and write a clear commit message explaining *why*, not
   just *what*.

## Project layout

- `src/openapi/` — document loading and `$ref` resolution
- `src/validation/` — request parameter and body validation
- `src/generation/` — deterministic, schema-driven response value generation
- `src/scenarios/` — scenario file loading and matching
- `src/server/` — HTTP routing, response selection, and the `node:http` server
- `src/cli.ts` — command-line entry point
- `test/` — vitest test suites, mirroring the `src/` layout

## Reporting issues

Please include: the OpenAPI document (or a minimal reproduction), the exact
command line used, and the request/response you expected versus what you got.

## Code style

- TypeScript, strict mode, ESM (`"type": "module"`).
- No implicit `any`; prefer explicit types on public function signatures.
- Keep runtime dependencies minimal — this project intentionally avoids a web
  framework in favor of `node:http`.
