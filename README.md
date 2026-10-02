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
- Esquema de base de datos: todo cambio de esquema, también el del núcleo (`public`), va en `db/migrations/NNNN_*.sql` (las migraciones del núcleo se llaman `NNNN_core_*.sql` y se aplican siempre antes que las editoriales). `0004_core_baseline.sql` congela el esquema núcleo existente y es idempotente (`IF NOT EXISTS` / bloques `DO`), así que los despliegues existentes no necesitan ningún paso manual: se aplica solo al arrancar, sin efecto si el esquema ya existe. Ya no hay DDL en `src/lib/database.ts`; los datos semilla y el backfill de membresías siguen en código.
- `npm run db:backup` — toma un backup ahora y aplica la retención. Ver «Backups y restauración»
- `npm run content:import` — valida en dry-run un export de Content Hub; requiere `--apply` para escribir
- `npm run postiz:cleanup` — limpia los vídeos/imágenes caducados de Postiz (dry-run por defecto; `--apply` para borrar). Ver «Limpieza de vídeos de Postiz»

## Variables de entorno

Copia `.env.example` a tu entorno local y ajusta lo necesario:

- `API_PORT` — puerto del backend Fastify
- `PORT` — fallback del puerto en algunos entornos
- `DATABASE_URL` — conexión PostgreSQL principal en producción
- `DATABASE_SSL` — modo SSL del cliente PostgreSQL (`disable`, `require`, etc.)
- `INFIDASH_BACKUP_DIR` — carpeta de backups (debe ser un volumen persistente; ver «Backups y restauración»)
- `INFIDASH_BACKUP_SCHEDULE_HOUR` — hora UTC (0-23) del backup diario programado; sin definir, los backups programados están desactivados
- `BACKUP_KEEP_DAILY` — backups diarios a conservar (0-365, por defecto 14)
- `BACKUP_KEEP_WEEKLY` — backups semanales a conservar (0-104, por defecto 8)
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

## Logs

La API escribe logs estructurados en JSON, un evento por línea, en la salida estándar (sin transportes ni `pino-pretty`). Cada línea incluye `time` (ISO 8601), `level`, `service: "infidash"` y `msg`.

- `LOG_LEVEL`: `fatal`, `error`, `warn`, `info` (por defecto), `debug`, `trace` o `silent`. Un valor no válido se trata como `info`. Con `NODE_ENV=test` los logs están en `silent` salvo que se defina `LOG_LEVEL`.
- Cada petición lleva un `reqId`, presente en todas sus líneas (petición recibida, respuesta con `statusCode` y `responseTime`, y errores con el campo `err`). Si el cliente envía `x-request-id` (8-100 caracteres `A-Za-z0-9._-`) se reutiliza; si no, se genera un UUID. El valor se devuelve siempre en la cabecera de respuesta `x-request-id`.
- Para seguir una petición: copia el `x-request-id` de la respuesta (por ejemplo desde las herramientas de red del navegador) y filtra los logs por ese valor, p. ej. `docker logs <contenedor> | grep <reqId>`.
- Las comprobaciones `/api/health` no se registran.
- Nunca se registran cabeceras ni cuerpos de petición. Se censuran `authorization`, `cookie`, `set-cookie`, `x-service-token`, contraseñas, tokens y claves en cualquier objeto logueado; el token de los webhooks de leads (`/api/public/leads/:token`) se sustituye por `[redacted]` en la URL, igual que los parámetros de consulta con nombres como `token`, `secret`, `password` o `api_key`; y las credenciales de cadenas de conexión (`postgresql://usuario:clave@host`) se enmascaran en los errores.

## Métricas

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
- Los backups se crean desde la API, con `npm run db:backup` o de forma programada, y se guardan en `data/backups/` por defecto. Ver «Backups y restauración».
- La sección **Contenidos** usa el esquema PostgreSQL `editorial`; no actives los workflows nuevos antes de aplicar sus migraciones.
- Los tokens de servicio de n8n se guardan solo como SHA-256 en `editorial.service_tokens`. La API nunca necesita el token en una variable de entorno.

## Backups y restauración

Los backups son volcados `pg_dump` en SQL plano (`--format=plain --no-owner --no-privileges`), comprimidos con gzip mientras se escriben. Incluyen todos los esquemas de la base (`public` y `editorial`). Nombre: `infidash-<etiqueta>-<AAAA-MM-DDTHH-MM-SS-mmmZ>.sql.gz` (hora UTC). Los `.sql` antiguos sin comprimir siguen siendo válidos y la retención los reconoce.

### Cómo tomar un backup

- **Consola de Easypanel (CLI):** `npm run db:backup` (opciones: `-- --label=antes-de-migrar`, `-- --no-retention`). Imprime el nombre y el tamaño; termina con código 1 si falla.
- **API (sesión admin):** `POST /api/admin/backup` con `{ "label": "opcional" }`. `GET /api/admin/backups` lista los backups (solo nombres, sin rutas), la configuración de la programación y el resultado de la última ejecución programada.
- **Programado:** define `INFIDASH_BACKUP_SCHEDULE_HOUR` (hora UTC, 0-23). Cada día, a partir de esa hora, se toma un backup con etiqueta `auto` y después se aplica la retención. Por defecto está desactivado. Hay un bloqueo en PostgreSQL para que dos procesos solapados (por ejemplo durante un despliegue) no hagan el volcado a la vez, y como máximo 3 intentos por día si falla. Los fallos se registran como `error` en los logs.

### Dónde están los ficheros

Se guardan en `INFIDASH_BACKUP_DIR` (por defecto `/data/backups` en Docker, `data/backups/` en local).

> **Atención:** `/data/backups` dentro del contenedor se pierde en cada redespliegue salvo que esté montado como volumen persistente o bind mount en Easypanel. Configura ese volumen antes de activar los backups programados.

> **Atención:** un backup en el mismo VPS no protege si se pierde el VPS. Copia los ficheros fuera del servidor (por ejemplo descargándolos por SFTP/WinSCP, o con `rclone` a un almacenamiento de objetos). Infidash no sube los backups a ningún sitio.

### Retención

Se conserva el backup más reciente de cada uno de los últimos `BACKUP_KEEP_DAILY` días (por defecto 14, UTC) y el más reciente de cada una de las últimas `BACKUP_KEEP_WEEKLY` semanas ISO (por defecto 8). El resto se elimina. El backup más reciente nunca se borra, sea cual sea la configuración. Solo se tocan ficheros con el nombre exacto de arriba (`infidash-….sql` / `.sql.gz`); cualquier otro fichero de la carpeta se ignora. La retención se aplica tras cada backup programado y con `npm run db:backup`, no con `POST /api/admin/backup`.

### Restaurar (PostgreSQL 17)

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

### Checklist de ensayo (repetir tras cada cambio relevante y al menos cada trimestre)

- [ ] `INFIDASH_BACKUP_DIR` apunta a un volumen persistente y el fichero sigue ahí tras un redespliegue.
- [ ] Hay un backup `auto` reciente en `GET /api/admin/backups` y `lastRun.ok` es `true`.
- [ ] Se ha copiado un backup fuera del VPS y se ha descargado desde esa copia.
- [ ] `gunzip -t fichero.sql.gz` no da errores.
- [ ] La restauración en una base de ensayo termina sin errores (paso 3).
- [ ] Los recuentos del paso 4 son coherentes con producción.
- [ ] Se ha anotado la fecha y el tiempo que tardó la restauración; se borra la base de ensayo (`dropdb`).

## Limpieza de vídeos de Postiz

Postiz (autoalojado con `STORAGE_PROVIDER=local`) guarda para siempre cada creatividad subida (reels de ~20 MB, imágenes) y su API pública no permite listar ni borrar medios. `npm run postiz:cleanup` borra del directorio de uploads los ficheros caducados. Es un script independiente que se ejecuta en el VPS donde corre Postiz; no forma parte de la API.

**Qué se borra.** Un fichero se considera caducado solo si TODAS las filas de Infidash que lo referencian están terminadas y su última actividad es anterior a la retención. Se leen `editorial.publications.media`, `editorial.social_posts.media` y la imagen de cabecera de los contenidos (`editorial.contents.seo.headerImageUrl`):

- Publicación terminada: `published`, `failed` o `cancelled`. Cualquier otro estado (`pending`, `sending`, `scheduled`, `unknown`, `cancel_requested`, `draft`) conserva el fichero. Última actividad: la mayor entre `published_at`, la fecha programada y `updated_at`.
- Post RRSS terminado: `discarded`, o `scheduled` cuya publicación enlazada está terminada. `review` y `approved` conservan el fichero.
- Contenido con imagen de cabecera: terminado si está `archived`, o `approved` con publicaciones y todas terminadas. Si una de sus publicaciones sigue viva, se conserva.
- Si un mismo fichero lo usan varias filas, basta una sin terminar (o reciente) para conservarlo. Ante cualquier duda, se conserva.
- Solo se tocan URLs bajo `POSTIZ_UPLOAD_URL_PREFIX` y con extensión `.mp4 .mov .m4v .webm .jpg .jpeg .png .webp`. Se rechazan rutas con `..`, absolutas, con `\` o enlaces simbólicos que salgan del directorio. Nunca se borran directorios ni ficheros no referenciados por Infidash.
- No se modifica ninguna fila de posts o publicaciones. En modo `--apply` cada fichero borrado queda anotado en `editorial.media_cleanup_log` (migración `0008`, que se aplica con `npm run db:migrate:editorial` o al arrancar), para poder mostrar «archivado» más adelante.

**Variables de entorno** (solo para este script; no están en `.env.example`):

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

## Despliegue continuo

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

## Documentación editorial

- [Plan aprobado](docs/plans/2026-09-15-content-hub-plan.md)
- [Persistencia e importación](docs/content-persistence.md)
- [Workflows n8n](docs/content-workflows.md)
- [Despliegue, migración y rollback](docs/content-deployment.md)
