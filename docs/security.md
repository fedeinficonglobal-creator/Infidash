# Security and configuration

## Production bootstrap

Set `NODE_ENV=production` and provide `INFIDASH_ADMIN_PASSWORD` (at least 12 characters) through the host's secret manager or an ignored local `.env` before the first database initialization. `INFIDASH_ADMIN_EMAIL` is optional and defaults to `admin@infidash.local`. The value is used only when no admin account exists; startup preserves stored users and sessions and will not reset an existing account password. Production does not create a default viewer; set `INFIDASH_VIEWER_PASSWORD` explicitly (12+ characters) only when an initial viewer is wanted.

Never commit `.env` or put credentials in client-side Vite variables. `.env.example` contains blank placeholders only.

## Authentication and diagnostics

Login allows five failed attempts per source IP in a 15-minute in-process window, returns HTTP 429 with `Retry-After`, and clears the window after successful authentication. This is a basic single-process safeguard; deployments with multiple API instances should also configure shared edge/proxy throttling. `/api/health` is liveness-only; dashboard counts require an authenticated session. Viewer responses include client data but redact bearer webhook secrets.

## Roadmap policies

Viewer access is agency-wide for client data. Monthly KPI cycles are intended to close on the 25th; the requested admin-only reopen rule, automated snapshot/catch-up and audited reopen behavior remain scheduled for roadmap Phase 4C and are not yet implemented.

Integration fields being complete is not proof of connectivity. WordPress probes/lead receipts and Clarity sync can report connected. A WooCommerce probe verifies read-only order access but deliberately keeps the card pending until sales synchronization is implemented and reconciled; ad-platform cards remain unverified.
