# Repository Guidelines

## Project Structure

`src/components/` contains the React UI; `src/store/` and `src/services/` hold client state and API clients. Shared domain helpers live in `src/lib/`, Fastify modules in `src/server/`, and the API entry point is root `server.ts`. Editorial PostgreSQL migrations are in `db/migrations/`; operational scripts are in `scripts/`; static assets are in `public/` and `assets/`. Tests are `tests/*.test.ts`, with isolated fixtures under `tests/fixtures/`. Product and operations documentation belongs in `docs/`. Versioned n8n exports are under `workflows/content/` (`dispatcher.v1.json`, `reconcile.v1.json`, and per-client `<client>/<kind>.v1.json` children); treat them as integration contracts and do not change them without an explicit, scoped request. Their `jsCode` strings are real code covered by `tests/content-workflows.test.ts`, which also asserts the exact export count and sanitization (disabled, no credentials, ids or pinData). Rename and sanitize raw n8n exports before adding them.

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

## Known Issues

- **Historical Clarity snapshots may contain false zeros** (found 2026-09-25): the former parser wrote each `{metricName, information}` item over the same daily row. The current parser aggregates a full export into one snapshot and the UI marks overwritten rows as incomplete. Clarity can only re-export the previous one to three days; older lost metrics cannot be reconstructed. Validate a real sync before treating the fix as deployed. See CLAUDE.md for the original analysis.
- **Clarity's `/test` endpoint never contacts Clarity** — it only checks field completeness and always reports `pending`. Use the separate "Sincronizar" button (real API call) to actually verify a Clarity integration.
- **Editorial jobs stuck in «Generando»** no longer need SQL: admins use «Marcar como fallida» (`POST /api/content/plan-items/:id/release-generation`). It refuses while an execution still holds a live lease.
- **GMB action URL is only validated in n8n** (`publish.v1.json` → `Validar publicacion`, falling back to `editorial_config.site_url`); the app accepts GMB publications without URL.
- **n8n runtime behaviour is unverified**: Code-node error outputs, Merge with stub inputs and Postiz/WordPress error shapes are only covered by simulated tests. Run a real plan, publish, reschedule and cancel execution before activating re-imported workflows.
