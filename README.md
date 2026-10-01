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

## Seguridad / arranque

- `NODE_ENV=production` es obligatorio en cualquier instancia expuesta. Fuera de producción se siembran las cuentas de desarrollo `admin@infidash.local` / `admin1234` y `viewer@infidash.local` / `viewer1234`; si se usan, el arranque imprime un aviso (`console.warn`) con las cuentas afectadas.
- En producción el primer administrador exige `INFIDASH_ADMIN_PASSWORD` de al menos 12 caracteres. Variables de arranque: `INFIDASH_ADMIN_EMAIL`, `INFIDASH_ADMIN_NAME`, `INFIDASH_ADMIN_PASSWORD`, `INFIDASH_VIEWER_EMAIL`, `INFIDASH_VIEWER_NAME` e `INFIDASH_VIEWER_PASSWORD` (el visualizador solo se crea en producción si se define su contraseña, de al menos 12 caracteres).
- `POST /api/auth/logout` revoca el token en el servidor y `POST /api/auth/logout-all` revoca todas las sesiones del usuario.
- Los errores inesperados se devuelven al cliente como `500 {"error":"Error interno del servidor","code":"INTERNAL_ERROR"}`; el detalle solo se escribe en el log del servidor.
- `INFIDASH_TRUST_PROXY`: sin definir, la app ignora `X-Forwarded-For` y todos los clientes que llegan a través de un proxy inverso comparten su IP (el rate limit y el bloqueo de login afectarían a todos a la vez; la app lo avisa una vez en el log). Acepta un entero (número de proxies delante de la app: EasyPanel/Traefik necesita `1`), `true` (confía en cualquier salto; inseguro salvo que la app solo sea accesible a través del proxy), `false`, o una lista de IPs/CIDR de proxies separadas por comas. Un valor inválido detiene el arranque.
- `INFIDASH_CSP_MODE`: `report-only` (por defecto), `enforce` u `off`. Empieza en `report-only`: abre la app con la consola de DevTools, recorre las pestañas y comprueba que no hay violaciones de CSP; después cambia a `enforce`. Los demás encabezados de seguridad (HSTS, `X-Frame-Options`, `Referrer-Policy`...) se envían siempre.
- Rate limiting por IP y minuto: `INFIDASH_RATE_LIMIT_MAX` (global, 1500 por defecto), `INFIDASH_RATE_LIMIT_LOGIN_MAX` (`POST /api/auth/login`, 10 por defecto) e `INFIDASH_RATE_LIMIT_LEADS_MAX` (`POST /api/public/leads/:token`, 120 por defecto, por IP y token). `/api/health` está exento y el límite se desactiva con `NODE_ENV=test` salvo que `INFIDASH_RATE_LIMIT_IN_TEST=1`.

- `GET /api/health` (público, sin autenticación y exento de rate limit) ejecuta un `SELECT 1` asíncrono contra el pool de PostgreSQL con un timeout de 2 s: responde `200 {"status":"ok"}` o `503 {"status":"degraded","checks":{"database":"down"}}` sin detalles de conexión (la causa solo va al log, como máximo una vez cada 30 s). `GET /api/health?deep=1` añade `checks.migrations` (`applied`/`pending` de `db/migrations`) y `checks.core` (consulta por el shim `psql`, que bloquea el event loop: úsalo solo a mano, no como healthcheck periódico) y devuelve 503 si hay migraciones pendientes.
- Protección SSRF: las URL que configura un administrador (`siteUrl`, `storeUrl` y `exportUrl` de las integraciones, y el `externalUrl` de las publicaciones) deben ser `http`/`https`, sin credenciales, y no pueden apuntar a `localhost`, nombres `.local`/`.internal`, loopback, redes privadas, link-local (`169.254.169.254`) ni a un nombre cuyo DNS resuelva a esas direcciones. Las redirecciones se revalidan (máximo 3, sin bajar de https a http). `INFIDASH_ALLOW_PRIVATE_URLS=1` desactiva esas comprobaciones y es solo para desarrollo local (nunca en producción).

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
