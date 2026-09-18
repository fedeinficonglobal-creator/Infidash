# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Infidash: a marketing agency dashboard (React + Fastify) for tracking clients, sales, traffic, SEO, RRSS (social), AI insights, reports, integrations, and an editorial "Contenidos" module that dispatches content-generation/publishing jobs to n8n workflows. Auth is local (email/password, sessions), with `admin`/`viewer` roles. UI copy and API error messages are in Spanish.

## Commands

```bash
npm run dev              # Vite frontend on http://127.0.0.1:3000 (proxies /api -> :4000)
npm run api              # Fastify API on http://127.0.0.1:4000 (alias: npm run dev:api / npm start)
npm run build             # production build (vite build)
npm run preview           # preview the build
npm run lint              # tsc --noEmit for both tsconfig.json and tsconfig.node.json (no separate linter)
npm run test              # tsx --test tests/*.test.ts
npm run db:migrate:editorial   # apply pending `editorial` schema migrations (advisory lock + checksum)
npm run content:import    # dry-run import of a Content Hub export; add -- --apply to write
```

Run the frontend and API in two separate terminals during development (`npm run dev` + `npm run api`). `DATABASE_URL` must be set (via `.env`/`.env.local`, copy from `.env.example`) — the app refuses to start without it.

To run a single test file: `npx tsx --test tests/content-workflows.test.ts`. Note `tests/api-regression.test.ts` is an integration test — it makes real HTTP calls to `API_BASE_URL` (default `http://127.0.0.1:4000`) and expects the API already running with seeded data; the rest of the suite is self-contained unit tests. `npm run test` sets no `NODE_ENV`, but `server.ts` skips its listener/scheduler when `NODE_ENV=test`.

## Architecture

### Two independent persistence paths to the same Postgres database

This is the most important thing to understand before touching data code — there are **two unrelated ways the app talks to PostgreSQL**, and they must not be conflated:

1. **Core app data** (`src/lib/database.ts`, ~1800 lines): users, clients, daily stats, integrations, UX snapshots, RRSS channels, monthly KPIs. This module does **not** use a `pg` connection pool — it shells out synchronously to the `psql` CLI (`spawnSync`) for every query, and to `pg_dump` for backups. SQL is built with `?`/`@name` placeholders that get inlined via `escapeSqlLiteral` (not parameterized at the protocol level — the CLI is invoked with the final SQL string). This module also contains one-time legacy-SQLite-to-Postgres import logic (`readLegacySqliteDump`, gated to non-production, shells out to `python`). Requires the `psql`/`pg_dump` binaries on `PATH` (installed via `postgresql-client` in the Dockerfile).
2. **Editorial/content module** (`src/server/content/*`): a normal async `pg.Pool` (`postgres.ts`) against the same `DATABASE_URL`, scoped entirely to the PostgreSQL schema `editorial` (never touches the public/core tables). Migrations for this schema live in `db/migrations/*.sql` and are applied by `scripts/migrate-editorial.ts` / `npm run db:migrate:editorial`, not by the core module.

When adding a data access function, match the pattern of the module you're extending — don't introduce a `pg.Pool` call into `src/lib/database.ts` or a `psql` shell-out into `src/server/content/*`.

### Backend structure

- `server.ts` — single Fastify entrypoint. Registers `contentRoutes` (editorial module) as a plugin, then defines all core REST routes inline (auth, users, clients, daily-stats, integrations, ux-snapshots, rrss-channels, monthly-kpis, backups, dashboard summary). Auth is a bearer/session token checked per-route via `requireSession(req, reply, roles)`; there's no global auth middleware/hook. Serves the built SPA (`dist/`) and falls back to `index.html` for non-`/api` routes in non-test mode.
- `src/lib/database.ts` — core data layer (see above) plus session/user management, backups (`createDatabaseBackup`, writes to `INFIDASH_BACKUP_DIR`), and a Clarity (UX analytics) integration sync path called both from a route and from a background interval (`startClaritySyncScheduler`, skipped when `NODE_ENV=test`).
- `src/lib/auth.ts`, `kpiThresholds.ts`, `integrationCatalog.ts`, `claritySync.ts` — supporting logic for password hashing/session tokens, per-client KPI threshold config, the catalog of supported integration providers/capabilities, and fetching Clarity UX snapshots.
- `src/server/content/` — the editorial module, structured as its own mini-service:
  - `contracts.ts` — shared validation/enum helpers and `ContentApiError`.
  - `repository.ts` / `apiRepository.ts` — data access against the `editorial` schema.
  - `routes.ts` — Fastify plugin exposing `/api/content/*`. Supports **two distinct auth modes** on the same routes: human sessions (`resolveHumanSession`, reusing the core session token from `src/lib/database.ts`) for the dashboard UI, and scoped **service tokens** (`serviceAuth.ts`, `authenticateServiceToken`) for n8n workflows — tokens are stored only as SHA-256 hashes in `editorial.service_tokens`, scoped per-client and per-capability (e.g. `jobs:claim`, `jobs:result`, `context:read`, `events:write`).
  - `migrations.ts` — the editorial migration runner (advisory lock, checksums, transactional).
  - `importContentHub.ts` — the legacy Content Hub importer used by `scripts/import-content-hub.ts`; requires an explicit ID-mapping file (never matches clients/accounts by name) and is idempotent via `editorial.legacy_mappings`.
  - `transitions.ts` — status transition rules for content jobs.
- `db/migrations/*.sql` — editorial schema only. Core-table schema is not migration-managed in this repo (see `src/lib/database.ts` bootstrapping).
- `workflows/content/*.json` — sanitized, disabled n8n workflow exports (dispatcher, plan/generate/publish per-client children, reconcile). These are documentation/reference artifacts, not executed by this repo. Job contracts are self-healing: Infidash re-reads `publications`/`publishing_accounts` server-side when a job is created or claimed rather than trusting client-submitted payloads. See `docs/content-workflows.md` and `docs/content-deployment.md` before changing job/lease/reconciliation semantics.

### Frontend structure

- `src/App.tsx` — top-level shell; renders `LoginScreen` until a session exists, then `Sidebar` + one of the per-domain tab components based on `activeTabId` from `useClientStore`.
- `src/store/useClientStore.ts` (Zustand) — session bootstrap/login/logout, client list, active client/tab selection; wraps `src/services/infidashApi.ts`.
- `src/store/useContentStore.ts` (Zustand) — editorial/content state; wraps `src/services/contentApi.ts`.
- `src/services/*.ts` — thin fetch wrappers per backend surface (`infidashApi.ts` core API, `contentApi.ts` editorial API, `aiService.ts` Gemini-backed AI insights, `healthService.ts`).
- `src/components/*Tab.tsx` — one component per sidebar section (Overview, Sales, Traffic, Web, SEO, Leads, RRSS, AI Insights, Reports, Integrations); `src/components/content/` holds the Contenidos tab.
- Frontend imports use explicit `.js` extensions on relative paths even though the source is `.ts`/`.tsx` (ESM `moduleResolution: bundler` convention used throughout this repo) — follow this when adding imports.
- Path alias `@/*` maps to the repo root (`tsconfig.json`, `vite.config.ts`).

### Deployment

Single Docker image: `npm run build` (Vite) then `npm run start` (`tsx server.ts`) serves both the API and the built SPA from one Fastify process on `PORT`/`API_PORT` (default 3001 in the container, 4000 locally). The image installs `python3`, `make`, `g++`, and `postgresql-client` — the latter is required at runtime for `src/lib/database.ts`'s `psql`/`pg_dump` shell-outs, not just for the build.

## Notes

- Don't enable/activate the n8n workflows in `workflows/content/` without applying editorial migrations first and following `docs/content-deployment.md` — they write through `editorial` job contracts that assume the schema and service-token scopes already exist.
- Service tokens for n8n are never read from an env var by the API; only their SHA-256 hash is persisted (`editorial.service_tokens`).
- **Known tech debt (not scheduled)**: `src/lib/database.ts`'s `psql`/`spawnSync` approach is a historical artifact (it replaced `better-sqlite3` before `pg` was ever added to the project — see commit `725f88b`), not a deliberate design choice. Migrating it to a `pg.Pool` like the editorial module would fix real issues (every query currently blocks Node's event loop, and SQL parameters are inlined/escaped manually instead of using real bind parameters) but touches ~1800 lines and nearly every route in `server.ts`, so it's deferred until explicitly prioritized. Don't "fix" this opportunistically inside an unrelated change.
