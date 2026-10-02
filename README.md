# Infidash

Infidash es un dashboard para agencias de marketing: seguimiento de clientes, ventas, tráfico, SEO, RRSS, leads, insights (reglas deterministas, sin modelo de IA), reportes e integraciones, más el módulo editorial **Contenidos**, que lanza trabajos de generación y publicación a flujos de n8n (con Postiz y WordPress). La autenticación es local (correo y contraseña, sesiones) con roles `admin` y `viewer`. La interfaz y los mensajes de error de la API están en español.

Stack: React 19 + Vite + Tailwind 4 (frontend), Fastify 5 (API), PostgreSQL (datos), n8n y Postiz (integraciones editoriales). Un único proceso Node sirve la API y el frontend compilado.

## Índice

- [Inicio rápido](#inicio-rápido)
- [Scripts npm](#scripts-npm)
- [Variables de entorno](#variables-de-entorno)
- [Arquitectura](#arquitectura)
- [Pruebas y CI](#pruebas-y-ci)
- [Seguridad / arranque](#seguridad--arranque)
- [Despliegue](#despliegue)
- [Operación](#operación)
- [Deuda conocida](#deuda-conocida)
- [Documentación](#documentación)

## Inicio rápido

Requisitos: Node.js 24 o superior (`engines` de `package.json`), npm y una base PostgreSQL accesible (producción usa PostgreSQL 17; CI usa 16). Para los backups hace falta además el cliente `pg_dump` en el `PATH`.

1. Instala las dependencias:
   ```bash
   npm ci
   ```
2. Crea tu configuración local a partir de `.env.example` (referencia de variables) y define como mínimo `DATABASE_URL`; la app no arranca sin ella:
   ```bash
   cp .env.example .env
   ```
3. Arranca la API (en `http://127.0.0.1:4000`). Al arrancar aplica las migraciones pendientes y siembra los datos iniciales:
   ```bash
   npm run api
   ```
4. En otra terminal, arranca el frontend (en `http://127.0.0.1:3000`, con proxy de `/api` hacia el puerto 4000):
   ```bash
   npm run dev
   ```
5. Abre `http://127.0.0.1:3000`. Fuera de producción se siembran cuentas de desarrollo (ver «Seguridad / arranque»).

## Scripts npm

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Frontend Vite en el puerto 3000 (proxy de `/api` a `127.0.0.1:4000`). |
| `npm run api` | API Fastify; también sirve el frontend compilado si existe `dist/`. Alias: `npm run dev:api` y `npm start`. |
| `npm run build` | Build de producción del frontend (`vite build`). |
| `npm run preview` | Preview del build. |
| `npm run lint` | Comprobación TypeScript (`tsc --noEmit`) de frontend y backend; no hay un linter aparte. |
| `npm test` | Suite segura de pruebas unitarias y de contrato (alias de `npm run test:unit`). |
| `npm run test:unit` | Igual que `npm test`. |
| `npm run test:db` | Pruebas que escriben en PostgreSQL; exigen una base desechable (ver «Pruebas y CI»). |
| `npm run test:api` | Arranca una API aislada y ejecuta las regresiones HTTP; exige una base desechable. |
| `npm run clean` | Borra `dist/` y `server.js` (no toca `data/`). |
| `npm run db:migrate:editorial` | Aplica las migraciones pendientes (núcleo primero, luego editorial) con lock y checksum. |
| `npm run db:backup` | Toma un backup ahora y aplica la retención. Ver «Backups y restauración». |
| `npm run postiz:cleanup` | Borra vídeos e imágenes caducados de Postiz (dry-run por defecto; `--apply` para borrar). Ver «Limpieza de vídeos de Postiz». |
| `npm run leads:erase` | Borra los leads de un correo (simulación por defecto; `--apply` para borrar). Ver «Retención de datos (RGPD)». |
| `npm run content:import` | Valida en dry-run un export de Content Hub; requiere `--apply` para escribir. |

Para ejecutar una sola prueba segura: `npx tsx --test tests/<nombre>.test.ts`. Las pruebas de base de datos y de API no se lanzan así: pasan por `scripts/run-tests.mjs`, que aplica la guarda de base desechable.

## Variables de entorno

`.env.example` es la referencia para empezar; esta sección recoge las variables que lee el código. Todas son opcionales salvo `DATABASE_URL`, y las que no se definen usan el valor por defecto indicado. Los scripts (`npm run db:*`, `postiz:cleanup`, etc.) y la app cargan `.env` mediante `dotenv`.

### Base de datos y arranque

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `DATABASE_URL` | obligatoria | Conexión PostgreSQL principal (`INFIDASH_DATABASE_URL` se acepta como alternativa). |
| `DATABASE_SSL` | sin definir | Vacío o `disable`: sin SSL. Cualquier otro valor activa SSL con verificación del certificado; `no-verify` lo activa sin verificarlo. |
| `API_PORT` / `PORT` | 4000 (3001 en la imagen Docker) | Puerto del servidor; `API_PORT` tiene prioridad sobre `PORT`. |
| `NODE_ENV` | sin definir | `production` es obligatorio en cualquier instancia expuesta (la imagen Docker ya lo define). `test` desactiva schedulers y rate limit. |
| `CORE_DB_POOL_MAX` | 10 | Tamaño máximo del pool del núcleo. |
| `CORE_DB_APPLICATION_NAME` | `infidash-core` | `application_name` de las conexiones del núcleo. |
| `EDITORIAL_DB_POOL_MAX` | 10 | Tamaño máximo del pool editorial. |
| `EDITORIAL_DB_IDLE_TIMEOUT_MS` | 30000 | Tiempo de inactividad antes de cerrar una conexión editorial. |
| `EDITORIAL_DB_CONNECTION_TIMEOUT_MS` | 5000 | Tiempo máximo para abrir una conexión editorial. |
| `EDITORIAL_DB_APPLICATION_NAME` | `infidash-editorial` | `application_name` de las conexiones editoriales. |
| `INFIDASH_SKIP_EDITORIAL_MIGRATIONS` | sin definir | Con `1`, el servidor no aplica las migraciones al arrancar. Solo para casos excepcionales. |
| `INFIDASH_SKIP_LEGACY_SQLITE_IMPORT` | sin definir | Con `1`, omite la importación puntual del SQLite heredado (`data/infidash.sqlite`). Ya se omite siempre en producción. |
| `INFIDASH_ADMIN_EMAIL`, `INFIDASH_ADMIN_NAME`, `INFIDASH_ADMIN_PASSWORD` | ver «Seguridad / arranque» | Primer administrador; en producción la contraseña (mínimo 12 caracteres) es obligatoria. |
| `INFIDASH_VIEWER_EMAIL`, `INFIDASH_VIEWER_NAME`, `INFIDASH_VIEWER_PASSWORD` | ver «Seguridad / arranque» | Usuario visualizador; en producción solo se crea si se define su contraseña (mínimo 12 caracteres). |

### Seguridad y proxy

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `INFIDASH_TRUST_PROXY` | sin definir | Cuántos proxies hay delante de la app (EasyPanel/Traefik necesita `1`). Ver «Seguridad / arranque». |
| `INFIDASH_CSP_MODE` | `report-only` | `report-only`, `enforce` u `off`. |
| `INFIDASH_RATE_LIMIT_MAX` | 1500 | Peticiones por IP y minuto (global). |
| `INFIDASH_RATE_LIMIT_LOGIN_MAX` | 10 | Intentos por IP y minuto en `POST /api/auth/login`. |
| `INFIDASH_RATE_LIMIT_LEADS_MAX` | 120 | Peticiones por IP y token y minuto en `POST /api/public/leads/:token`. |
| `INFIDASH_RATE_LIMIT_IN_TEST` | sin definir | Con `1`, mantiene el rate limit con `NODE_ENV=test`. |
| `INFIDASH_ALLOW_PRIVATE_URLS` | sin definir | Con `1`, desactiva la protección SSRF. Solo desarrollo local, nunca en producción. |

### Logs y métricas

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `LOG_LEVEL` | `info` (`silent` con `NODE_ENV=test`) | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent`. Ver «Logs». |
| `METRICS_FAILED_JOBS_WARN` | 1 | Jobs `failed` en 24 h a partir de los cuales se emite `editorial queue alert`. Ver «Métricas». |

### Backups programados

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `INFIDASH_BACKUP_DIR` | `data/backups/` en local, `/data/backups` en Docker | Carpeta de backups; en producción debe ser un volumen persistente. |
| `INFIDASH_BACKUP_SCHEDULE_HOUR` | sin definir (programación desactivada) | Hora UTC (0-23) del backup diario programado. |
| `BACKUP_KEEP_DAILY` | 14 | Backups diarios a conservar (0-365). |
| `BACKUP_KEEP_WEEKLY` | 8 | Backups semanales a conservar (0-104). |

### Clave de cifrado

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `INFIDASH_CREDENTIALS_KEY` | sin definir (credenciales en texto plano) | Clave AES-256-GCM de 32 bytes en base64. Ver «Cifrado de credenciales». |
| `INFIDASH_CREDENTIALS_KEY_PREVIOUS` | sin definir | Clave anterior, solo durante una rotación. |

### Postiz y subida de creatividades

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `POSTIZ_API_URL` | sin definir | Base de la API pública de Postiz (p. ej. `https://postiz.TU-DOMINIO/api`). Sin ella y sin `POSTIZ_API_KEY`, la subida de creatividades responde 503 `POSTIZ_NOT_CONFIGURED`. |
| `POSTIZ_API_KEY` | sin definir | Clave de la API de Postiz. |
| `POSTIZ_PUBLIC_URL` | origen de `POSTIZ_API_URL` | URL pública usada para convertir en absolutas las rutas relativas de uploads. |
| `INFIDASH_MAX_CONCURRENT_UPLOADS` | 3 | Subidas simultáneas de creatividades (entero de 1 a 10); por encima responde 503 `UPLOAD_BUSY`. |
| `INFIDASH_UPLOAD_TMP_DIR` | directorio temporal del sistema | Carpeta de los ficheros temporales de subida. |
| `POSTIZ_UPLOAD_DIR` | obligatoria para `postiz:cleanup` | Directorio de uploads de Postiz tal como lo ve el script. |
| `POSTIZ_UPLOAD_URL_PREFIX` | obligatoria para `postiz:cleanup` (salvo `--check-disk`) | Prefijo de URL que corresponde a ese directorio. |
| `POSTIZ_MEDIA_RETENTION_DAYS` | 7 | Días de retención de `postiz:cleanup` (1-365). |

### Retención de leads

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `LEADS_RETENTION_MONTHS` | 24 | Meses que se conservan los leads (1-120). |
| `LEADS_RAW_PAYLOAD_DAYS` | 90 | Días tras los que se vacía el payload bruto del formulario (1-3650). |

### Integraciones y credenciales compartidas

GA4 y Google Ads usan una sola credencial para toda la agencia, definida solo en el entorno del servidor; Clarity y SMTP son opcionales. Las credenciales por cliente (WooCommerce, WordPress) no van en variables de entorno: se introducen por integración en la app.

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `GA4_SERVICE_ACCOUNT_JSON` | sin definir | JSON de la cuenta de servicio de GA4 (debe incluir `client_email` y `private_key`). Sin ella, GA4 no está configurado. |
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | sin definir | Credenciales OAuth de la cuenta de administrador (MCC) de Google Ads; hacen falta las cinco, si no Google Ads responde 503 `GOOGLE_ADS_NOT_CONFIGURED`. |
| `CLARITY_EXPORT_URL` (o `CLARITY_EXPORT_URL_TEMPLATE`) | URL de exportación de Clarity | URL de exportación de datos de Clarity si no se define por integración. |
| `CLARITY_SYNC_INTERVAL_MS` | 86400000 (24 h) | Intervalo de la sincronización automática; no puede ser inferior a 24 h. |
| `CLARITY_SYNC_TIMEOUT_MS` | 15000 | Timeout de cada sincronización con Clarity. |
| `INFIDASH_MONTHLY_AUTO_CLOSE` | sin definir (desactivado) | Con `1`, activa el cierre automático de KPI mensuales (ver `docs/monthly-kpi-close.md`). |
| `REPORT_SMTP_HOST`, `REPORT_SMTP_FROM` | sin definir | Servidor y remitente SMTP para enviar reportes; sin ellos el envío queda deshabilitado. |
| `REPORT_SMTP_PORT` | 587 | Puerto SMTP (465 usa TLS implícito, el resto STARTTLS). |
| `REPORT_SMTP_USER`, `REPORT_SMTP_PASSWORD` | sin definir | Autenticación SMTP; deben definirse juntas. |

Los secretos de n8n (`INFIDASH_INTERNAL_API_URL`, `INFIDASH_SERVICE_TOKEN`, `OPENAI_API_KEY`, etc.) se configuran en el contenedor de n8n, no en Infidash. Para desarrollo: `DISABLE_HMR=true` desactiva el HMR y el watcher de Vite. Las pruebas usan `INFIDASH_TEST_DATABASE_URL` e `INFIDASH_TEST_API_BASE_URL` (ver «Pruebas y CI»).

## Arquitectura

Infidash es un único servicio: `server.ts` (Fastify) expone la API, sirve el frontend compilado (`dist/`) y arranca los schedulers. El detalle de diseño y la historia operativa están en `CLAUDE.md`; aquí va lo imprescindible.

- **Dos pools `pg` independientes sobre la misma base de datos.** Los datos del núcleo (usuarios, sesiones, clientes, estadísticas, integraciones, leads, KPIs) viven en `src/lib/database.ts` + `src/lib/corePool.ts` (esquema `public`, solo parámetros `$n`). El módulo editorial vive en `src/server/content/*` con su propio pool, acotado al esquema `editorial`. No se mezclan.
- **Migraciones.** Todo cambio de esquema, también el del núcleo, va en `db/migrations/NNNN_*.sql`; las del núcleo se llaman `NNNN_core_*.sql` y se aplican siempre antes que las editoriales. Se aplican al arrancar, con `npm run db:migrate:editorial` y en CI, con lock consultivo y checksums (`public.schema_migrations`). `0004_core_baseline.sql` congela el esquema núcleo existente y es idempotente, así que los despliegues existentes no necesitan pasos manuales. Nunca se edita una migración ya aplicada: el runner la rechaza; un cambio es una migración nueva. Los datos semilla y el backfill de membresías siguen en código.
- **Schedulers en segundo plano** (desactivados con `NODE_ENV=test`, con bloqueo de PostgreSQL donde dos instancias no deben solaparse): sincronización de Clarity, purga horaria de sesiones, cierre de KPIs mensuales (opt-in), backups diarios (opt-in), retención de leads y reporter de métricas por minuto.
- **Capa de seguridad** (`src/server/security.ts` y módulos asociados): cabeceras con helmet y CSP, rate limiting, `INFIDASH_TRUST_PROXY`, protección SSRF para URLs de administrador, errores genéricos hacia el cliente, logs con redacción de secretos y cifrado de credenciales en reposo. Ver «Seguridad / arranque» y `docs/security.md`.
- **Módulo editorial (Contenidos).** Rutas `/api/content/*` con dos modos de autenticación: sesiones humanas para la UI y tokens de servicio con ámbito para n8n (solo se guarda su SHA-256). Los workflows de `workflows/content/` son exports saneados y desactivados, solo de referencia.
- **Patrón de integraciones.** Cliente basado en `fetch` en `src/lib/<proveedor>.ts`, tabla de snapshots, rutas `preview`/`sync`/`snapshot` (administrador sincroniza, visualizador lee). WooCommerce y WordPress usan credenciales por cliente; GA4 y Google Ads usan una credencial compartida de la agencia.
- **Frontend.** `src/App.tsx` (shell), un componente `*Tab.tsx` por sección cargado con `React.lazy`, stores Zustand (`useClientStore`, `useContentStore`) con selectores, clientes de API en `src/services/` y formato de importes y fechas en `src/lib/format.ts`. Los imports relativos llevan extensión `.js`; el alias `@/*` apunta a la raíz del repositorio.

## Pruebas y CI

- `npm test` / `npm run test:unit`: suite segura, sin base de datos. Es la que debe pasar siempre en local.
- `npm run test:db`: pruebas que escriben en PostgreSQL.
- `npm run test:api`: arranca una API aislada y lanza las regresiones HTTP.

Las suites `db` y `api` fallan en cerrado salvo que `INFIDASH_TEST_DATABASE_URL` apunte a una base PostgreSQL desechable en loopback cuyo nombre contenga un segmento `test` distinto (por ejemplo `infidash_test`); la suite `api` exige además `INFIDASH_TEST_API_BASE_URL` (origen loopback, por ejemplo `http://127.0.0.1:4000`). Nunca las apuntes a datos compartidos, de staging o de producción. Detalles en `docs/testing.md`.

CI (`.github/workflows/ci.yml`, Node 24) tiene cuatro jobs:

| Job | Qué ejecuta |
| --- | --- |
| `safe-checks` | `npm audit --audit-level=high`, `npm run lint`, `npm test`, `npm run build` y el presupuesto de bundle (`tests/bundle-budget.test.ts`). |
| `database-tests` | `npm run test:db` sobre PostgreSQL 16 y dos ejecuciones de `db:migrate:editorial` para comprobar la idempotencia. |
| `api-tests` | `npm run build` y `npm run test:api`. |
| `docker-build` | Construye la imagen de producción y la comprueba (Node 24, `tsx` y `pg_dump` 17 presentes, sin compiladores ni devDependencies). |

Un cambio está terminado cuando pasan los cuatro. Verificación rápida en local:

```bash
npm run lint
npm test
npm run build
```

## Seguridad / arranque

- `NODE_ENV=production` es obligatorio en cualquier instancia expuesta. Fuera de producción se siembran las cuentas de desarrollo `admin@infidash.local` / `admin1234` y `viewer@infidash.local` / `viewer1234`; si se usan, el arranque imprime un aviso (`console.warn`) con las cuentas afectadas.
- En producción el primer administrador exige `INFIDASH_ADMIN_PASSWORD` de al menos 12 caracteres. Variables de arranque: `INFIDASH_ADMIN_EMAIL`, `INFIDASH_ADMIN_NAME`, `INFIDASH_ADMIN_PASSWORD`, `INFIDASH_VIEWER_EMAIL`, `INFIDASH_VIEWER_NAME` e `INFIDASH_VIEWER_PASSWORD` (el visualizador solo se crea en producción si se define su contraseña, de al menos 12 caracteres).
- `POST /api/auth/logout` revoca el token en el servidor y `POST /api/auth/logout-all` revoca todas las sesiones del usuario.
- Los errores inesperados se devuelven al cliente como `500 {"error":"Error interno del servidor","code":"INTERNAL_ERROR"}`; el detalle solo se escribe en el log del servidor.
- `INFIDASH_TRUST_PROXY`: sin definir, la app ignora `X-Forwarded-For` y todos los clientes que llegan a través de un proxy inverso comparten su IP (el rate limit y el bloqueo de login afectarían a todos a la vez; la app lo avisa una vez en el log). Acepta un entero (número de proxies delante de la app: EasyPanel/Traefik necesita `1`), `true` (confía en cualquier salto; inseguro salvo que la app solo sea accesible a través del proxy), `false`, o una lista de IPs/CIDR de proxies separadas por comas. Un valor inválido detiene el arranque.
- `INFIDASH_CSP_MODE`: `report-only` (por defecto), `enforce` u `off`. Empieza en `report-only`: abre la app con la consola de DevTools, recorre las pestañas y comprueba que no hay violaciones de CSP; después cambia a `enforce`. Los demás encabezados de seguridad (HSTS, `X-Frame-Options`, `Referrer-Policy`...) se envían siempre.
- Rate limiting por IP y minuto: `INFIDASH_RATE_LIMIT_MAX` (global, 1500 por defecto), `INFIDASH_RATE_LIMIT_LOGIN_MAX` (`POST /api/auth/login`, 10 por defecto) e `INFIDASH_RATE_LIMIT_LEADS_MAX` (`POST /api/public/leads/:token`, 120 por defecto, por IP y token). `/api/health` está exento y el límite se desactiva con `NODE_ENV=test` salvo que `INFIDASH_RATE_LIMIT_IN_TEST=1`.

- `GET /api/health` (público, sin autenticación y exento de rate limit) ejecuta un `SELECT 1` asíncrono contra el pool de PostgreSQL con un timeout de 2 s: responde `200 {"status":"ok"}` o `503 {"status":"degraded","checks":{"database":"down"}}` sin detalles de conexión (la causa solo va al log, como máximo una vez cada 30 s). `GET /api/health?deep=1` añade `checks.migrations` (`applied`/`pending` de `db/migrations`) y `checks.core` (consulta al pool del núcleo) y devuelve 503 si hay migraciones pendientes.
- Protección SSRF: las URL que configura un administrador (`siteUrl`, `storeUrl` y `exportUrl` de las integraciones, y el `externalUrl` de las publicaciones) deben ser `http`/`https`, sin credenciales, y no pueden apuntar a `localhost`, nombres `.local`/`.internal`, loopback, redes privadas, link-local (`169.254.169.254`) ni a un nombre cuyo DNS resuelva a esas direcciones. Las redirecciones se revalidan (máximo 3, sin bajar de https a http). `INFIDASH_ALLOW_PRIVATE_URLS=1` desactiva esas comprobaciones y es solo para desarrollo local (nunca en producción).

## Despliegue

Imagen Docker multietapa (`node:24-trixie-slim`): la etapa de build ejecuta `npm ci`, `npm run build` y `npm prune --omit=dev`; la etapa de runtime lleva Node y `postgresql-client` (`pg_dump` 17, igual que producción) y arranca con `npm run start` (`tsx server.ts`), que sirve la API y el frontend desde un solo proceso en el puerto `PORT` (3001 en el contenedor). Define `NODE_ENV=production` y `INFIDASH_BACKUP_DIR=/data/backups`, y el `HEALTHCHECK` consulta `/api/health`. El contenedor se ejecuta como root a propósito, porque los volúmenes de backups y de uploads de Postiz pertenecen a root en el host.

Producción corre en EasyPanel:

- El despliegue es manual («Implementar») salvo que configures el despliegue continuo opcional (ver «Despliegue continuo»).
- `/data/backups` debe ser un volumen persistente; si usas `postiz:cleanup`, el directorio de uploads de Postiz se monta como bind mount.
- `GET /api/health` (público, `SELECT 1` con timeout de 2 s) y `GET /api/version` (público, devuelve `startedAt`, la hora de arranque del proceso) sirven al orquestador y a la puerta de despliegue.
- Las migraciones se aplican al arrancar el contenedor, antes de abrir el puerto.
- Haz backup antes de fusionar migraciones que cambien tipos o borren filas (`npm run db:backup`).
- Vuelta atrás: `git revert` del commit y redespliegue; si una migración ya se aplicó, restaurar el backup es el único camino.
- Una línea `npm error signal SIGTERM` en la consola es normal cuando EasyPanel sustituye el contenedor antiguo durante un despliegue.

### Despliegue continuo

Cada merge a `main` con el CI en verde puede desplegarse solo en EasyPanel. Es opcional: mientras no configures lo de abajo, el workflow `Deploy` se salta y el despliegue sigue siendo manual (botón «Implementar»).

**Activarlo (una vez):**

1. En EasyPanel, servicio de Infidash, busca la URL de **despliegue por webhook** («Deploy Webhook» / «Trigger URL», en la pestaña de origen o de despliegue) y cópiala. Quien tenga esa URL puede lanzar un despliegue: trátala como un secreto.
2. En GitHub: Settings → Secrets and variables → Actions:
   - **Secret** `EASYPANEL_DEPLOY_URL`: la URL del paso 1.
   - **Variable** `INFIDASH_BASE_URL`: la URL pública de Infidash, sin barra final (p. ej. `https://infidash.tudominio.com`).
3. Para probarlo sin esperar a un merge: Actions → Deploy → Run workflow.

**Qué hace:** espera a que el CI termine bien en `main`, llama al webhook de EasyPanel y comprueba cada 10 segundos (hasta 15 minutos) que el contenedor nuevo ha arrancado (`GET /api/version` devuelve `startedAt`, la hora de arranque del proceso, posterior al despliegue) y que `GET /api/health?deep=1` responde 200 (base de datos y migraciones al día). Si no lo consigue, el job falla y GitHub te avisa. Los despliegues no se solapan: uno nuevo espera al que está en curso.

**Migraciones:** se aplican al arrancar el contenedor (antes de abrir el puerto), no en un paso previo. Si una migración falla, el contenedor nuevo no llega a estar sano y el workflow marca el despliegue como fallido. Las migraciones que cambian tipos o borran filas no tienen vuelta atrás con el código anterior: haz backup antes de fusionarlas (`npm run db:backup`).

**Vuelta atrás:** haz `git revert` del commit problemático en `main` (por una PR) y el mismo flujo despliega la versión anterior. Si una migración ya se aplicó, restaurar el backup es el único camino para deshacerla (ver «Backups y restauración»).

## Operación

### Cifrado de credenciales

Las credenciales por cliente de las integraciones (WooCommerce, WordPress, etc.), guardadas en `integrations.credentials_json`, se cifran en reposo con AES-256-GCM a nivel de aplicación. Cada valor se guarda como `enc:v1:<iv>:<tag>:<cifrado>` en la misma columna, con un IV aleatorio por escritura y el id de la integración como dato autenticado (un cifrado copiado a otra fila no se puede descifrar). Las respuestas de la API nunca devuelven secretos y los logs los censuran.

**No cubre** `integrations.webhook_secret` (el secreto de la URL del webhook de leads), que sigue en texto plano.

#### Activar el cifrado

1. Genera una clave de 32 bytes en base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Defínela como `INFIDASH_CREDENTIALS_KEY` en las variables de entorno del servicio Infidash en EasyPanel y redespliega.
3. En el arranque, las credenciales existentes en texto plano se cifran automáticamente (una sola transacción, idempotente; solo se registran recuentos, nunca valores).

**Advertencia:** si pierdes la clave, pierdes las credenciales de cliente guardadas. Guárdala también en un gestor de contraseñas y nunca en el repositorio, en el chat ni en la carpeta de backups. Los backups de `pg_dump` contienen texto cifrado: la clave debe guardarse separada de ellos.

#### Sin clave

Si `INFIDASH_CREDENTIALS_KEY` no está definida, nada cambia: las credenciales siguen en texto plano y el arranque registra un aviso (`credentials encryption disabled: INFIDASH_CREDENTIALS_KEY is not set`). Si ya hay filas cifradas y falta la clave (o no sirve para descifrarlas), el arranque falla con un error claro para no ejecutar con credenciales ilegibles.

#### Rotar la clave

1. Define `INFIDASH_CREDENTIALS_KEY_PREVIOUS` con la clave antigua y `INFIDASH_CREDENTIALS_KEY` con la nueva.
2. Redespliega: el arranque descifra con la actual o, si no, con la anterior, y re-cifra todo con la nueva.
3. Comprueba que arranca bien y elimina `INFIDASH_CREDENTIALS_KEY_PREVIOUS`.

### Logs

La API escribe logs estructurados en JSON, un evento por línea, en la salida estándar (sin transportes ni `pino-pretty`). Cada línea incluye `time` (ISO 8601), `level`, `service: "infidash"` y `msg`.

- `LOG_LEVEL`: `fatal`, `error`, `warn`, `info` (por defecto), `debug`, `trace` o `silent`. Un valor no válido se trata como `info`. Con `NODE_ENV=test` los logs están en `silent` salvo que se defina `LOG_LEVEL`.
- Cada petición lleva un `reqId`, presente en todas sus líneas (petición recibida, respuesta con `statusCode` y `responseTime`, y errores con el campo `err`). Si el cliente envía `x-request-id` (8-100 caracteres `A-Za-z0-9._-`) se reutiliza; si no, se genera un UUID. El valor se devuelve siempre en la cabecera de respuesta `x-request-id`.
- Para seguir una petición: copia el `x-request-id` de la respuesta (por ejemplo desde las herramientas de red del navegador) y filtra los logs por ese valor, p. ej. `docker logs <contenedor> | grep <reqId>`.
- Las comprobaciones `/api/health` no se registran.
- Nunca se registran cabeceras ni cuerpos de petición. Se censuran `authorization`, `cookie`, `set-cookie`, `x-service-token`, contraseñas, tokens y claves en cualquier objeto logueado; el token de los webhooks de leads (`/api/public/leads/:token`) se sustituye por `[redacted]` en la URL, igual que los parámetros de consulta con nombres como `token`, `secret`, `password` o `api_key`; y las credenciales de cadenas de conexión (`postgresql://usuario:clave@host`) se enmascaran en los errores.

### Retención de datos (RGPD)

El runbook completo (inventario de datos personales, plazos, terceros, borrado de un cliente, solicitudes de interesados) está en `docs/gdpr-retention.md`. Lo que aplica el propio código:

- Los leads con más de `LEADS_RETENTION_MONTHS` meses (entero de 1 a 120, por defecto 24) se borran solos. Un valor `0`, vacío o no válido se trata como 24: no hay forma de desactivar la purga por variable de entorno, solo poniendo un valor muy grande (120 meses como máximo).
- El payload bruto del formulario (`raw_payload_json`) de los leads con más de `LEADS_RAW_PAYLOAD_DAYS` días (entero de 1 a 3650, por defecto 90) se vacía a `{}`; nombre, correo, teléfono y mensaje se conservan hasta que caduca el lead.
- La purga corre una vez al día (primera ejecución 2 minutos después de arrancar), bajo un bloqueo de PostgreSQL para que dos instancias no la ejecuten a la vez, y solo registra recuentos (`retencion de leads aplicada`: `deleted`, `payloadsBlanked`), nunca datos personales. No se ejecuta con `NODE_ENV=test`.
- `npm run leads:erase -- --email=persona@ejemplo.com [--client=<idCliente>] [--note="texto"] [--apply]` atiende una solicitud de supresión. Sin `--apply` solo cuenta e indica los ids; con `--apply` borra en una transacción y registra el recuento, la nota y un prefijo del hash SHA-256 del correo (nunca el correo en claro). Los backups existentes conservan el dato hasta que rotan.

### Métricas

`GET /api/admin/metrics` (solo administradores) responde cuántos jobs editoriales fallan y si hay 5xx sin abrir la base de datos. Los contadores HTTP viven en memoria (se reinician con el proceso) y solo guardan cifras agregadas por minuto, nunca URLs, ids ni cabeceras.

```bash
curl -s -H "Authorization: Bearer <token-de-sesion-admin>" https://<tu-dominio>/api/admin/metrics
```

Desde la consola del navegador con la sesión iniciada, el token es el mismo que usa la app (cabecera `Authorization: Bearer ...` de cualquier petición en la pestaña Red).

```json
{
  "generatedAt": "2026-10-02T10:00:00.000Z",
  "uptimeSeconds": 86400,
  "process": { "rssMb": 180, "heapUsedMb": 90, "eventLoopLagMs": 12.3 },
  "http": {
    "last15m": {
      "windowMinutes": 15, "total": 420, "status2xx": 400, "status3xx": 5, "status4xx": 14, "status5xx": 1,
      "latencyMs": { "lt50": 300, "lt100": 80, "lt250": 30, "lt500": 8, "lt1000": 2, "lt2500": 0, "gte2500": 0 },
      "status5xxPerMinute": 0.067, "errorRatio": 0.0024
    },
    "last60m": { "windowMinutes": 60, "...": "misma forma" }
  },
  "db": { "coreOk": true, "coreLatencyMs": 3, "editorialOk": true, "editorialLatencyMs": 2 },
  "editorialJobs": {
    "byStatus": { "pending": 0, "running": 1, "succeeded": 120, "failed": 4 },
    "last24hByStatus": { "succeeded": 12, "failed": 2 },
    "failedByKind": { "publish": { "retrying": 1, "frozen": 1 } },
    "failedLast24h": 2,
    "failedRetrying": 1,
    "failedFrozen": 1,
    "oldestPendingAgeSeconds": null,
    "expiredLeases": 0,
    "recentFailures": [
      { "id": "...", "kind": "publish", "clientId": "...", "attemptCount": 8, "updatedAt": "2026-10-02T09:00:00.000Z", "lastError": "..." }
    ]
  },
  "backups": { "lastRun": { "at": "2026-10-02T03:00:12.000Z", "ok": true, "name": "...", "sizeBytes": 1234567 } },
  "disk": { "usedPercent": 41.2, "freeGb": 58.4 }
}
```

- `failedRetrying` son jobs `failed` con menos de 8 intentos (se reintentarán); `failedFrozen` los que ya alcanzaron 8 y no se reclaman. `oldestPendingAgeSeconds` es la antigüedad del job `pending` ya vencido más viejo (cola atascada) y `expiredLeases` cuenta jobs `running` con la lease caducada.
- Cada sección que falle devuelve `{ "error": "unavailable" }` sin tumbar el resto; `disk` solo aparece si existe el directorio de backups.
- Logs a buscar: `http minute summary` (nivel `info`, una línea por minuto con al menos un 5xx: `minute`, `total`, `status5xx`, `errorRatio`) y `editorial queue alert` (nivel `warn`, como máximo cada 10 minutos mientras haya jobs fallidos en las últimas 24 h; campos `failedLast24h`, `failedRetrying`, `failedFrozen`, `threshold`). Si todo está sano no se escribe nada.
- `METRICS_FAILED_JOBS_WARN` (opcional, por defecto `1`): número de jobs `failed` actualizados en las últimas 24 h a partir del cual se emite `editorial queue alert`. Los jobs congelados antiguos (`failedFrozen`) no disparan la alerta; siguen visibles en `/api/admin/metrics`.

### Backups y restauración

Los backups son volcados `pg_dump` en SQL plano (`--format=plain --no-owner --no-privileges`), comprimidos con gzip mientras se escriben. Incluyen todos los esquemas de la base (`public` y `editorial`). Nombre: `infidash-<etiqueta>-<AAAA-MM-DDTHH-MM-SS-mmmZ>.sql.gz` (hora UTC). Los `.sql` antiguos sin comprimir siguen siendo válidos y la retención los reconoce.

#### Cómo tomar un backup

- **Consola de Easypanel (CLI):** `npm run db:backup` (opciones: `-- --label=antes-de-migrar`, `-- --no-retention`). Imprime el nombre y el tamaño; termina con código 1 si falla.
- **API (sesión admin):** `POST /api/admin/backup` con `{ "label": "opcional" }`. `GET /api/admin/backups` lista los backups (solo nombres, sin rutas), la configuración de la programación y el resultado de la última ejecución programada.
- **Programado:** define `INFIDASH_BACKUP_SCHEDULE_HOUR` (hora UTC, 0-23). Cada día, a partir de esa hora, se toma un backup con etiqueta `auto` y después se aplica la retención. Por defecto está desactivado. Hay un bloqueo en PostgreSQL para que dos procesos solapados (por ejemplo durante un despliegue) no hagan el volcado a la vez, y como máximo 3 intentos por día si falla. Los fallos se registran como `error` en los logs.

#### Dónde están los ficheros

Se guardan en `INFIDASH_BACKUP_DIR` (por defecto `/data/backups` en Docker, `data/backups/` en local).

> **Atención:** `/data/backups` dentro del contenedor se pierde en cada redespliegue salvo que esté montado como volumen persistente o bind mount en Easypanel. Configura ese volumen antes de activar los backups programados.

> **Atención:** un backup en el mismo VPS no protege si se pierde el VPS. Copia los ficheros fuera del servidor (por ejemplo descargándolos por SFTP/WinSCP, o con `rclone` a un almacenamiento de objetos). Infidash no sube los backups a ningún sitio.

#### Retención

Se conserva el backup más reciente de cada uno de los últimos `BACKUP_KEEP_DAILY` días (por defecto 14, UTC) y el más reciente de cada una de las últimas `BACKUP_KEEP_WEEKLY` semanas ISO (por defecto 8). El resto se elimina. El backup más reciente nunca se borra, sea cual sea la configuración. Solo se tocan ficheros con el nombre exacto de arriba (`infidash-….sql` / `.sql.gz`); cualquier otro fichero de la carpeta se ignora. La retención se aplica tras cada backup programado y con `npm run db:backup`, no con `POST /api/admin/backup`.

#### Restaurar (PostgreSQL 17)

El volcado no incluye `DROP`/`CREATE DATABASE` ni propietarios, así que se restaura siempre en una base **vacía**. No restaures nunca directamente sobre producción para «probar»: primero en una base de ensayo.

1. Descarga el fichero a una máquina con cliente `psql` 17 (o usa la consola del contenedor, que ya lo trae).
2. Crea una base de ensayo vacía (no necesita extensiones: el esquema no usa ninguna):
   ```bash
   createdb -h HOST -U USUARIO infidash_restore_test
   export SCRATCH_URL="postgres://USUARIO:CLAVE@HOST:5432/infidash_restore_test"
   ```
3. Restaura (se detiene al primer error y es todo-o-nada):
   ```bash
   gunzip -c infidash-auto-2026-10-02T03-00-00-000Z.sql.gz | psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 --single-transaction
   ```
   Para un `.sql` sin comprimir: `psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 --single-transaction -f fichero.sql`.
4. Verifica (compara con producción en el momento del backup, teniendo en cuenta que producción puede haber cambiado desde entonces):
   ```sql
   SELECT 'users' AS tabla, count(*) FROM public.users
   UNION ALL SELECT 'clients', count(*) FROM public.clients
   UNION ALL SELECT 'daily_stats', count(*) FROM public.daily_stats
   UNION ALL SELECT 'leads', count(*) FROM public.leads
   UNION ALL SELECT 'editorial.jobs', count(*) FROM editorial.jobs;
   SELECT max(version) FROM public.schema_migrations;
   ```
5. Opcional: arranca una instancia local con `DATABASE_URL="$SCRATCH_URL"` y comprueba el login y un cliente.
6. Para restaurar de verdad (desastre): detén la app, restaura en una base nueva vacía, comprueba, apunta `DATABASE_URL` a ella (o renómbrala) y arranca. Los roles/propietarios se recrean con los del usuario que restaura (`--no-owner`).

#### Checklist de ensayo (repetir tras cada cambio relevante y al menos cada trimestre)

- [ ] `INFIDASH_BACKUP_DIR` apunta a un volumen persistente y el fichero sigue ahí tras un redespliegue.
- [ ] Hay un backup `auto` reciente en `GET /api/admin/backups` y `lastRun.ok` es `true`.
- [ ] Se ha copiado un backup fuera del VPS y se ha descargado desde esa copia.
- [ ] `gunzip -t fichero.sql.gz` no da errores.
- [ ] La restauración en una base de ensayo termina sin errores (paso 3).
- [ ] Los recuentos del paso 4 son coherentes con producción.
- [ ] Se ha anotado la fecha y el tiempo que tardó la restauración; se borra la base de ensayo (`dropdb`).

### Limpieza de vídeos de Postiz

Postiz (autoalojado con `STORAGE_PROVIDER=local`) guarda para siempre cada creatividad subida (reels de ~20 MB, imágenes) y su API pública no permite listar ni borrar medios. `npm run postiz:cleanup` borra del directorio de uploads los ficheros caducados. Es un script independiente que se ejecuta en el VPS donde corre Postiz; no forma parte de la API.

**Qué se borra.** Un fichero se considera caducado solo si TODAS las filas de Infidash que lo referencian están terminadas y su última actividad es anterior a la retención. Se leen `editorial.publications.media`, `editorial.social_posts.media` y la imagen de cabecera de los contenidos (`editorial.contents.seo.headerImageUrl`):

- Publicación terminada: `published`, `failed` o `cancelled`. Cualquier otro estado (`pending`, `sending`, `scheduled`, `unknown`, `cancel_requested`, `draft`) conserva el fichero. Última actividad: la mayor entre `published_at`, la fecha programada y `updated_at`.
- Post RRSS terminado: `discarded`, o `scheduled` cuya publicación enlazada está terminada. `review` y `approved` conservan el fichero.
- Contenido con imagen de cabecera: terminado si está `archived`, o `approved` con publicaciones y todas terminadas. Si una de sus publicaciones sigue viva, se conserva.
- Si un mismo fichero lo usan varias filas, basta una sin terminar (o reciente) para conservarlo. Ante cualquier duda, se conserva.
- Solo se tocan URLs bajo `POSTIZ_UPLOAD_URL_PREFIX` y con extensión `.mp4 .mov .m4v .webm .jpg .jpeg .png .webp`. Se rechazan rutas con `..`, absolutas, con `\` o enlaces simbólicos que salgan del directorio. Nunca se borran directorios ni ficheros no referenciados por Infidash.
- No se modifica ninguna fila de posts o publicaciones. En modo `--apply` cada fichero borrado queda anotado en `editorial.media_cleanup_log` (migración `0008`, que se aplica con `npm run db:migrate:editorial` o al arrancar), para poder mostrar «archivado» más adelante.

**Variables de entorno** (solo para este script; ver también «Variables de entorno»):

- `POSTIZ_UPLOAD_DIR` — obligatoria. Directorio de uploads de Postiz tal como lo ve el script.
- `POSTIZ_UPLOAD_URL_PREFIX` — obligatoria. Prefijo de URL que corresponde a ese directorio, p. ej. `https://postiz.example.com/uploads` (también vale solo la ruta, `/uploads`, que acepta cualquier host).
- `POSTIZ_MEDIA_RETENTION_DAYS` — días de retención, entero de 1 a 365 (por defecto 7). El flag `--days=N` tiene prioridad.
- `DATABASE_URL` — la misma que usa Infidash (no hace falta con `--check-disk`).

**Uso.**

```bash
npm run postiz:cleanup                 # dry-run: lista lo que borraría, no borra nada
npm run postiz:cleanup -- --apply      # borra los ficheros caducados
npm run postiz:cleanup -- --days=14    # otra retención
npm run postiz:cleanup -- --check-disk --warn-percent=80 --min-free-gb=10
```

Empieza siempre con el dry-run y revisa la lista. El script termina con código distinto de cero si algún borrado falla (el resto de ficheros se procesan igualmente) y es idempotente: una segunda ejecución ignora lo ya borrado.

**Montar el volumen.** El script necesita acceso de lectura y escritura al directorio de uploads de Postiz. En EasyPanel, monta el mismo volumen/bind mount que usa Postiz (por ejemplo `/uploads` de Postiz, en el host `/etc/easypanel/projects/<proyecto>/postiz/volumes/...`) dentro del contenedor desde el que se ejecuta el script, o ejecútalo en el host con una copia del repositorio y apunta `POSTIZ_UPLOAD_DIR` a esa ruta.

**Programarlo.** Ejemplo de cron diario (03:30) en el host:

```cron
30 3 * * * cd /ruta/a/infidash && /usr/bin/env npm run postiz:cleanup -- --apply >> /var/log/postiz-cleanup.log 2>&1
```

En EasyPanel puedes usar un Cron Job del servicio de Infidash con el comando `npm run postiz:cleanup -- --apply` (con el volumen montado y las variables definidas).

**Alerta de disco.** `npm run postiz:cleanup -- --check-disk` no necesita base de datos: muestra el uso del sistema de ficheros del directorio de uploads y sale con código 1 si el uso es mayor o igual que `--warn-percent` (80 por defecto) o si quedan menos GB libres que `--min-free-gb`. Úsalo en otro cron para que avise por correo o monitorización.

**Limitaciones.**

- Las entradas de la biblioteca de medios de Postiz quedan huérfanas (la entrada sigue visible en Postiz, pero sin fichero); este script solo libera disco.
- Las imágenes que los workflows de n8n suben directamente a Postiz (imágenes de cabecera) solo se limpian cuando están referenciadas por filas de Infidash; los ficheros sin referencia se conservan siempre.
- No se eliminan subdirectorios vacíos y las instantáneas antiguas de revisiones de contenido no cuentan como referencia.

### Datos y persistencia

- La app requiere `DATABASE_URL` para arrancar.
- El contenido de `data/` se limita a backups y se genera en tiempo de ejecución cuando aplica.
- Fuera de producción, la app se inicializa con datos semilla para poder probar login y dashboard desde el primer arranque.

### Notas operativas

- La autenticación usa sesión/token con roles `admin` y `viewer`.
- Los backups se crean desde la API, con `npm run db:backup` o de forma programada, y se guardan en `data/backups/` por defecto. Ver «Backups y restauración».
- La sección **Contenidos** usa el esquema PostgreSQL `editorial`; no actives los workflows nuevos antes de aplicar sus migraciones (ver `docs/content-deployment.md`).
- Los tokens de servicio de n8n se guardan solo como SHA-256 en `editorial.service_tokens`. La API nunca necesita el token en una variable de entorno.
- Los fallos de Contenidos suelen ser silenciosos en la interfaz: antes de depurar un job atascado revisa `docs/editorial-recovery.md` y `docs/content-workflows.md`.

## Deuda conocida

Elementos aplazados a propósito (detalle en `CLAUDE.md`):

- Los importes (`daily_stats.revenue` y `cpa`) son `REAL`; la migración a `NUMERIC(12,2)` está aplazada.
- La CSP está en `report-only` por defecto y todavía permite hosts de Google Fonts.
- `integrations.webhook_secret` (token de la URL de leads) está en texto plano; el cifrado de credenciales no lo cubre.
- No hay purga de snapshots de proveedores, `report_runs` ni `editorial.jobs`/`events` (ver `docs/gdpr-retention.md`).
- TypeScript estricto y contratos compartidos entre cliente y servidor no están empezados.
- Los backups no se copian fuera del servidor automáticamente: hazlo tú (ver «Backups y restauración»).

## Documentación

| Documento | Contenido |
| --- | --- |
| [docs/security.md](docs/security.md) | Seguridad y configuración. |
| [docs/testing.md](docs/testing.md) | Suites de pruebas y guarda de base desechable. |
| [docs/gdpr-retention.md](docs/gdpr-retention.md) | Runbook de retención de datos y RGPD. |
| [docs/lead-webhooks.md](docs/lead-webhooks.md) | Webhooks de formularios WordPress. |
| [docs/woocommerce-and-reports.md](docs/woocommerce-and-reports.md) | WooCommerce y primer informe PDF. |
| [docs/saved-reports.md](docs/saved-reports.md) | Reportes guardados y envío SMTP. |
| [docs/monthly-kpi-close.md](docs/monthly-kpi-close.md) | Cierre de KPI mensuales. |
| [docs/operational-plans.md](docs/operational-plans.md) | Planes Web y RRSS compartidos. |
| [docs/content-persistence.md](docs/content-persistence.md) | Persistencia e importación editorial. |
| [docs/content-workflows.md](docs/content-workflows.md) | Workflows editoriales n8n. |
| [docs/content-deployment.md](docs/content-deployment.md) | Despliegue, migración y rollback del módulo editorial. |
| [docs/editorial-recovery.md](docs/editorial-recovery.md) | Preparación y recuperación editorial. |
| [docs/plans/2026-09-15-content-hub-plan.md](docs/plans/2026-09-15-content-hub-plan.md) | Plan aprobado de Contenidos. |
| [docs/plans/2026-05-20-infidash-kpi-ux-plan.md](docs/plans/2026-05-20-infidash-kpi-ux-plan.md) | Plan de KPI y análisis UX. |
| [AGENTS.md](AGENTS.md) y [CLAUDE.md](CLAUDE.md) | Guía para colaboradores y para agentes de IA: arquitectura detallada, problemas conocidos y flujo de trabajo. |
