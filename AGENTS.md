# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React/Vite frontend and Fastify services: reusable UI lives in `src/components/`, with data access, server code, integrations, and state organized under `src/db/`, `src/server/`, `src/services/`, and `src/store/`. Root `server.ts` starts the API. PostgreSQL migrations are in `db/migrations/`; automated tests are in `tests/`. Static assets belong in `public/`, operational scripts in `scripts/`, and editorial automation definitions in `workflows/content/`. Keep docs and plans in `docs/`.

## Build, Test, and Development Commands

Run `npm install` to install dependencies. Start the API with `npm run api` and the Vite frontend separately with `npm run dev` (port 3000). Use `npm run build` for a production frontend build, `npm run preview` to inspect it, `npm run lint` for TypeScript checks across frontend and backend configs, and `npm run test` for the Node test-runner suite. For editorial work, `npm run db:migrate:editorial` applies migrations and `npm run content:import` validates imports in dry-run mode; pass `--apply` only when intended to write data.

## Coding Style & Naming Conventions

Use TypeScript/TSX with two-space indentation, semicolons, and single quotes where consistent with neighboring files. Use PascalCase for React components, camelCase for functions and variables, and descriptive kebab-case for migration filenames. Follow existing module boundaries and prefer small, focused changes. No standalone formatter or linter is configured; `npm run lint` is the required type-check.

## Testing Guidelines

Tests use Node's built-in test runner through `tsx` and live in `tests/*.test.ts`. Name new files `<feature>.test.ts` and keep coverage near the behavior being changed. Run `npm run test`, plus `npm run lint` and `npm run build` before submitting; tests that depend on PostgreSQL or external services should document their local prerequisites.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style prefixes and optional scopes, e.g. `feat(leads): ...`, `fix(server): ...`, and `style(ui): ...`. Keep commits focused and use imperative summaries. A pull request should explain the user-visible change, note relevant migrations or configuration, link the issue when applicable, and include screenshots for UI changes. Report test, lint, and build results.

## Security & Configuration

Use `.env.example` as the template for local configuration; never commit real credentials, service tokens, or production data. Confirm database and migration prerequisites before enabling related workflows.
