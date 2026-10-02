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
- `npm run content:import` — valida en dry-run un export de Content Hub; requiere `--apply` para escribir
- `npm run postiz:cleanup` — limpia los vídeos/imágenes caducados de Postiz (dry-run por defecto; `--apply` para borrar). Ver «Limpieza de vídeos de Postiz»

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

## Documentación editorial

- [Plan aprobado](docs/plans/2026-09-15-content-hub-plan.md)
- [Persistencia e importación](docs/content-persistence.md)
- [Workflows n8n](docs/content-workflows.md)
- [Despliegue, migración y rollback](docs/content-deployment.md)
