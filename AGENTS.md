# Repository Guidelines

## Project Structure

`src/components/` contains the React UI; `src/store/` and `src/services/` hold client state and API clients. Shared domain helpers live in `src/lib/`, Fastify modules in `src/server/`, and the API entry point is root `server.ts`. Editorial PostgreSQL migrations are in `db/migrations/`; operational scripts are in `scripts/`; static assets are in `public/` and `assets/`. Tests are `tests/*.test.ts`, with isolated fixtures under `tests/fixtures/`. Product and operations documentation belongs in `docs/`. Versioned n8n exports are under `workflows/content/`; treat them as integration contracts and do not change them without an explicit, scoped request.

## Build, Test, and Development

- `npm ci` installs the lockfile-defined dependencies.
- `npm run dev` starts Vite on port 3000; `npm run api` starts Fastify (default port 4000). Run them in separate terminals for local development.
- `npm run lint` type-checks frontend and backend TypeScript configurations.
- `npm test` / `npm run test:unit` run the safe unit and contract suites.
- `npm run build` creates the production frontend in `dist/`; `npm run preview` serves that build.
- `npm run test:db` and `npm run test:api` require `INFIDASH_TEST_DATABASE_URL` pointing to a disposable loopback PostgreSQL database with a distinct `test` name segment. API tests also use `INFIDASH_TEST_API_BASE_URL` (loopback only). Never target shared, staging, or production data. See `docs/testing.md`.
- `npm run db:migrate:editorial` applies editorial migrations; `npm run content:import` defaults to a dry run. Use write flags only after reviewing the preview.

## Style and Testing

Use TypeScript/TSX, two-space indentation, semicolons, and the surrounding file's quote conventions. React components use PascalCase; functions, variables, and test filenames use camelCase or descriptive kebab-case as appropriate (`tests/lead-query.test.ts`). Add regression coverage beside the affected behavior. Keep provider credentials and real customer data out of tests, logs, fixtures, and commits. Workflow-export tests validate structure/contracts, not execution in a live n8n instance.

## Commits and Pull Requests

Use the Conventional Commit prefixes present in history, such as `feat(leads): ...`, `fix(server): ...`, and `test(integrations): ...`. Keep changes focused. PRs should summarize behavior, link related issues, call out migrations/configuration, attach UI screenshots when relevant, and report tests, lint, and build results. Never commit secrets; use `.env.example` as the configuration reference.
