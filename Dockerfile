# ---- build stage: full toolchain and devDependencies, produces dist/ ----
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

# ---- runtime stage: Node + pg_dump only (no compilers, no devDependencies) ----
FROM node:24-bookworm-slim AS runtime

# pg_dump is needed at runtime for the admin backup endpoint; psql is no longer used.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV INFIDASH_BACKUP_DIR=/data/backups

# The app runs from TypeScript sources through tsx (a runtime dependency) and serves the built SPA from dist/.
COPY --from=build /app ./

EXPOSE 3001

# /api/health answers 503 when the database is unreachable, so the orchestrator can restart a broken container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# The container still runs as root on purpose: the bind-mounted Postiz uploads directory and the backups volume
# are owned by root on the host. Switch to `USER node` only after checking those permissions (audit plan W5.1).
CMD ["npm", "run", "start"]
