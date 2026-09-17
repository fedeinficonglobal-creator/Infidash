# Infidash

Infidash es un dashboard para agencias con autenticación local y persistencia en PostgreSQL, con vistas operativas para clientes, ventas, tráfico, SEO, RRSS, insights IA, reportes e integraciones.

## Requisitos

- Node.js 18+ recomendado
- npm

## Scripts

- `npm run dev` — levanta el frontend Vite en `http://127.0.0.1:3000`
- `npm run api` — levanta la API Fastify en `http://127.0.0.1:4000`
- `npm run build` — build de producción
- `npm run preview` — preview del build
- `npm run lint` — comprobación TypeScript para frontend y backend
- `npm run test` — suite de regresión
- `npm run clean` — borra `dist/` y `server.js` (no toca `data/`)
- `npm run db:migrate:editorial` — aplica migraciones editoriales pendientes con lock y checksum
- `npm run content:import` — valida en dry-run un export de Content Hub; requiere `--apply` para escribir

## Variables de entorno

Copia `.env.example` a tu entorno local y ajusta lo necesario:

- `API_PORT` — puerto del backend Fastify
- `PORT` — fallback del puerto en algunos entornos
- `DATABASE_URL` — conexión PostgreSQL principal en producción
- `DATABASE_SSL` — modo SSL del cliente PostgreSQL (`disable`, `require`, etc.)
- `INFIDASH_BACKUP_DIR` — carpeta de backups
- `APP_URL` — URL pública/local del frontend cuando haga falta generar enlaces o callbacks
- `EDITORIAL_DB_POOL_MAX`, `EDITORIAL_DB_IDLE_TIMEOUT_MS` y `EDITORIAL_DB_CONNECTION_TIMEOUT_MS` — límites del pool asíncrono del módulo editorial

## Arranque local

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Arranca la API:
   ```bash
   npm run api
   ```
3. En otra terminal, arranca el frontend:
   ```bash
   npm run dev
   ```
4. Abre `http://127.0.0.1:3000`

## Datos y persistencia

- La app requiere `DATABASE_URL` para arrancar.
- El contenido de `data/` se limita a backups y se genera en tiempo de ejecución cuando aplica.
- La app se inicializa con datos semilla para poder probar login y dashboard desde el primer arranque.

## Verificación rápida

```bash
npm run lint
npm run test
npm run build
```

## Notas operativas

- La autenticación usa sesión/token con roles `admin` y `viewer`.
- Los backups se crean desde la API y se guardan en `data/backups/` por defecto.
- La sección **Contenidos** usa el esquema PostgreSQL `editorial`; no actives los workflows nuevos antes de aplicar sus migraciones.
- Los tokens de servicio de n8n se guardan solo como SHA-256 en `editorial.service_tokens`. La API nunca necesita el token en una variable de entorno.

## Documentación editorial

- [Plan aprobado](docs/plans/2026-09-15-content-hub-plan.md)
- [Persistencia e importación](docs/content-persistence.md)
- [Workflows n8n](docs/content-workflows.md)
- [Despliegue, migración y rollback](docs/content-deployment.md)
