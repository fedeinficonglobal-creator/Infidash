# Retención de datos y RGPD — runbook

**Fecha:** 2026-10-02 · **Plan de origen:** W6.4 (`docs/plans/2026-10-01-audit-remediation-plan.md`) · **Estado:** borrador pendiente de revisión del responsable.

Este documento describe qué datos personales guarda Infidash, cuánto tiempo los conserva **según el código actual**, a quién se envían, cómo se borra un cliente o a una persona y qué hacer ante una brecha. Todo lo que sale del código está contrastado con el repositorio; lo que no se puede verificar desde el repositorio (configuración del servidor, EasyPanel, n8n, Postiz) está marcado como **no verificable**. Las bases jurídicas son **sugerencias a validar por el responsable**; este documento no es asesoramiento legal.

Decisiones ya tomadas por el responsable (2026-10-02):

1. Los leads se conservan **24 meses**.
2. Al borrar un cliente solo se borran los datos **internos de Infidash**. El contenido ya publicado en sistemas de terceros (WordPress, redes sociales vía Postiz, Sheets) **se queda** donde está.
3. La persona que revisa este documento es el responsable del tratamiento.

## 1. Inventario de datos personales

Los nombres de tabla son del esquema `public` (núcleo) o `editorial`. Fuente: `db/migrations/0001`–`0008` y `src/lib/database.ts`.

| Dato | Dónde (tabla.columna) | Qué contiene | Finalidad | Base jurídica sugerida (a validar por el responsable) |
| --- | --- | --- | --- | --- |
| Cuentas de usuario | `users.email`, `users.name`, `users.password_hash`, `role`, `active` | Correo y nombre del equipo de la agencia y de los clientes con acceso. La contraseña se guarda como hash PBKDF2 con sal (`src/lib/auth.ts`), nunca en claro. | Acceso al panel | Ejecución de contrato / interés legítimo (seguridad) |
| Sesiones | `sessions.token_hash`, `user_id`, `created_at`, `expires_at` | Solo el hash SHA-256 del token, no el token. | Mantener la sesión iniciada | Interés legítimo (seguridad) |
| Accesos por cliente | `client_memberships.user_id`, `client_id` | Qué usuario ve qué cliente. | Control de acceso | Interés legítimo |
| Leads | `leads.name`, `email`, `phone`, `message`, `source`, `status`, `dedupe_key`, `received_at` | Datos que una persona escribe en un formulario de la web de un cliente y que llegan por webhook. | Gestión comercial del cliente | Consentimiento o medidas precontractuales de quien rellena el formulario; Infidash actúa como **encargado** del cliente (a confirmar con el contrato de encargo) |
| Payload bruto del lead | `leads.raw_payload_json` | Cuerpo JSON completo recibido (`server.ts`, `rawPayload: body`). Puede incluir campos que el formulario envíe además de los cinco reconocidos. **Nunca se devuelve por la API**: la lista de leads lo descarta (`listLeadsByClient`). | Depuración de la recepción | Interés legítimo; minimización (por eso se vacía a los 90 días, ver sección 2) |
| Credenciales de integraciones | `integrations.credentials_json` | Secretos de terceros por cliente (WordPress, WooCommerce…), no datos de personas, pero dan acceso a sus sistemas. Cifradas en reposo con AES-256-GCM **solo si** `INFIDASH_CREDENTIALS_KEY` está definida; sin esa variable quedan en texto plano (`docs/security.md`, README «Cifrado de credenciales»). | Conectar con la web/tienda del cliente | Ejecución de contrato |
| Secreto del webhook | `integrations.webhook_secret` | Secreto de la URL de recepción de leads. **Siempre en texto plano** (`README`, «Cifrado de credenciales»). | Autenticar el webhook | Interés legítimo (seguridad) |
| Informes PDF | `report_runs.pdf_base64`, `last_sent_to`, `created_by_user_id` | El PDF completo en base64 (métricas del cliente) y el **correo del destinatario** del último envío. | Entregar informes al cliente | Ejecución de contrato |
| Eventos de KPI mensual | `monthly_kpi_events.actor_user_id`, `reason`, `snapshot_json`; `monthly_kpi_cycles.closed_by_user_id`, `reopened_by_user_id`, `reopen_reason` | Quién cerró/reabrió un mes y una copia de los KPI. Estas columnas **no tienen clave foránea**: el id de usuario sobrevive al borrado de ese usuario (queda como identificador huérfano). | Auditoría interna | Interés legítimo |
| KPI y estadísticas | `monthly_kpis.created_by_user_id`/`updated_by_user_id`, `daily_stats`, `ux_snapshots`, snapshots de WooCommerce/GA4/Google Ads | Métricas agregadas de negocio. Los pedidos de WooCommerce guardan id, estado, importes y fechas, **sin datos del comprador** (`WooCommerceOrderSummary`). No son datos personales de usuarios finales. | Seguimiento del cliente | Ejecución de contrato |
| Contenidos editoriales | `editorial.contents`, `content_revisions` (`author_id`), `publications`, `social_posts`, `plan_items`, `calendars` (`created_by`), `jobs.payload/result`, `events` (`actor_id`), `research_snapshots` | Textos, copys, medios y planes de contenido del cliente; ids de usuario autores. Normalmente no son datos personales salvo que el texto mencione personas. | Producción y publicación de contenido | Ejecución de contrato |
| Medios en Postiz | Ficheros en el directorio de uploads de Postiz (referenciados por `publications.media`, `social_posts.media`, `contents.seo.headerImageUrl`) | Vídeos e imágenes. Pueden mostrar personas (a validar caso por caso). | Publicación en redes | Ejecución de contrato / consentimiento de las personas que aparezcan |
| Logs | Salida estándar del proceso (pino, JSON) | Ver el detalle justo debajo. | Operación y seguridad | Interés legítimo |
| Backups | `INFIDASH_BACKUP_DIR` (`infidash-<etiqueta>-<fecha>.sql.gz`) | Volcado completo de `public` y `editorial`: **contiene todo lo anterior**. | Continuidad del servicio | Interés legítimo |

**Qué se registra exactamente en los logs** (`src/lib/logger.ts`): por petición, `reqId`, método, URL saneada, `statusCode`, `responseTime` y `remoteAddress` (la IP, `request.ip`). La IP es la real del cliente solo si está definida `INFIDASH_TRUST_PROXY`; detrás de EasyPanel/Traefik sin esa variable sería la del proxy (no verificable desde aquí). **No** se registran cabeceras (por tanto no el *user agent*), ni cuerpos, ni cookies; se censuran tokens, contraseñas y claves; el token del webhook de leads se sustituye por `[redacted]` en la URL. Los parámetros de consulta no secretos sí aparecen en la URL registrada. El limitador de intentos de login guarda IPs solo en memoria durante 15 minutos (`src/lib/loginThrottle.ts`) y no persiste nada.

## 2. Plazos de conservación

Columna «Implementado» = lo que hace el código hoy. «Brecha» = no hay purga automática.

| Dato | Plazo | Implementado | Cómo se aplica |
| --- | --- | --- | --- |
| Leads (nombre, correo, teléfono, mensaje) | **24 meses** desde `received_at` | Sí (nuevo en W6.4) | `src/lib/leadsRetention.ts`: borrado diario en lotes de 500. Variable `LEADS_RETENTION_MONTHS` (entero 1–120, por defecto 24; `0` o valor inválido = 24). **No se puede desactivar por variable de entorno**; solo subiendo el valor (máximo 120). |
| Payload bruto del lead (`raw_payload_json`) | **90 días** desde `received_at` | Sí (nuevo en W6.4) | Se sustituye por `{}` (columna `NOT NULL DEFAULT '{}'`). Variable `LEADS_RAW_PAYLOAD_DAYS` (entero 1–3650, por defecto 90). Los demás campos del lead se conservan hasta los 24 meses. |
| Sesiones | **12 horas** desde el login (`createSession`) | Sí | Purga horaria de sesiones caducadas (`purgeExpiredSessions`, primera pasada 30 s tras arrancar) y borrado al presentar un token caducado. |
| Backups | Último de cada uno de los **14 días** y de las **8 semanas ISO** más recientes | Sí, **solo si** se ejecuta el backup programado (`INFIDASH_BACKUP_SCHEDULE_HOUR`) o `npm run db:backup`; la retención no se aplica con `POST /api/admin/backup` | `src/lib/backupRetention.ts`. Variables `BACKUP_KEEP_DAILY` (por defecto 14) y `BACKUP_KEEP_WEEKLY` (por defecto 8). Un dato borrado de la base puede seguir en backups hasta unas 8 semanas. Copias fuera del servidor (VPS, EasyPanel): **no verificable**. |
| Medios en Postiz | **7 días** desde que la publicación termina | Sí, **manual**: `npm run postiz:cleanup -- --apply` | `scripts/postiz-media-cleanup.ts`; `POSTIZ_MEDIA_RETENTION_DAYS` (1–365, por defecto 7). El repositorio no lo programa: si hay un cron en el VPS es **no verificable**. |
| Logs | Sin plazo en la aplicación | No aplica | La app solo escribe en la salida estándar; la rotación y el tiempo de retención los decide el host (Docker/EasyPanel): **no verificable**. Los logs de borrado de leads solo llevan recuentos y un prefijo de hash. |
| Cuentas de usuario | Mientras la cuenta exista | Sin purga automática | Se borran a mano con `DELETE /api/users/:id` (administrador). Ver sección 5. |
| Snapshots WooCommerce / GA4 / Google Ads | Sin plazo | **Brecha**: no hay ninguna purga (solo se insertan/actualizan por clave integración + periodo). Se borran en cascada al borrar la integración o el cliente. | Son métricas agregadas sin datos personales de usuarios finales, así que el riesgo es de espacio y de minimización, no de datos personales. |
| Snapshots de Clarity (`ux_snapshots`) | Sin plazo | **Brecha**: ídem. | Métricas agregadas por sincronización. |
| Informes (`report_runs`) | Sin plazo | **Brecha**: no existe ninguna purga ni borrado individual en el código; el PDF y el correo del destinatario (`last_sent_to`) se conservan mientras exista el cliente. | Candidato a una purga futura (decisión abierta, sección 7). |
| `daily_stats`, KPI mensuales, canales RRSS, planes operativos | Mientras exista el cliente | Sin purga independiente | Se borran con el cliente. |
| Contenido editorial (`editorial.*`) | Mientras exista el cliente | Sin purga independiente | Se borran con el cliente. `editorial.jobs` y `events` crecen sin límite (brecha menor, sin datos personales relevantes). |

**Aviso de despliegue.** En el primer arranque con este cambio, unos 2 minutos después, se borrarán todos los leads con más de 24 meses que ya existan. Antes de desplegar: toma un backup y cuenta cuántos se verían afectados con `SELECT count(*) FROM leads WHERE received_at < now() - interval '24 months';`.

## 3. Encargados y terceros

Infidash recibe datos de los clientes y los envía a estos sistemas. Qué se envía a cada uno sale del código y de `workflows/content/*.json` (solo se han leído nombres de variables y URLs, no valores).

| Tercero | Para qué | Datos que recibe | Notas |
| --- | --- | --- | --- |
| Servidor/VPS y EasyPanel | Aloja la app, la base de datos, los backups y los logs | Todo | Contrato de alojamiento y ubicación: **no verificable**. |
| PostgreSQL | Almacén único | Todo | Mismo servidor o servicio gestionado: **no verificable**. |
| Postiz (autoalojado) | Programar y publicar en Facebook, Instagram y Google Business Profile | Copys, medios y cuentas de publicación (vía n8n, `POSTIZ_*`) | Los ficheros subidos viven en el disco de Postiz (ver sección 2). |
| WordPress del cliente | Publicar entradas y recibir imágenes destacadas; origen de los leads | Contenido de blog e imágenes (credenciales por cliente). Envía a Infidash los leads por webhook. | El contenido publicado es del cliente y no lo gestiona Infidash. |
| n8n | Ejecuta los workflows editoriales | Contenido, planes y resultados; token de servicio de Infidash | Ubicación y retención de ejecuciones (historial de n8n): **no verificable**. |
| OpenAI (`api.openai.com`, vía n8n) | Generación y humanización de textos | Temas, palabras clave y contenido en generación; no se envían leads | Condiciones de OpenAI y acuerdo de tratamiento: **a revisar**. |
| SerpAPI, Jina (`r.jina.ai`), SerpRobot (vía n8n) | Investigación de palabras clave y lectura de páginas | Palabras clave, URLs públicas y el proyecto SerpRobot | Sin datos personales previstos. |
| Google Analytics 4 y Google Ads | Métricas de tráfico y publicidad | Se reciben datos agregados con una credencial compartida de la agencia | Infidash solo lee. |
| Microsoft Clarity | Analítica de experiencia de usuario | Se reciben métricas agregadas | `/test` no contacta con Clarity; la sincronización sí. |
| Proveedor SMTP (`REPORT_SMTP_*`) | Enviar informes PDF por correo | Correo del destinatario y el PDF | Proveedor concreto: **no verificable**. |
| Google Search Console | — | — | No hay integración en el código (solo menciones en `SeoTab.tsx`). |
| Meta Ads | — | — | Figura en el catálogo de integraciones pero no tiene adaptador real (`hasLiveIntegrationAdapter`). |
| Google Sheets | Según el responsable se usa para contenido publicado | — | No hay ninguna referencia en el repositorio: la relación con Infidash es **no verificable**. |

## 4. Borrado de un cliente

`DELETE /api/clients/:clientId` (solo administrador) llama a `deleteClient` (`src/lib/database.ts`), que trabaja en **una transacción**.

**Qué se borra** (verificado por la prueba `tests/core-characterization.retention.test.ts`, que se ejecuta con `npm run test:db`):

- Núcleo, por cascada desde `public.clients`: `integrations` y sus snapshots de WooCommerce/GA4/Google Ads, `leads`, `daily_stats`, `ux_snapshots`, `operational_plans`, `report_runs`, `rrss_channels`, `monthly_kpis`, `monthly_kpi_cycles`, `client_memberships`.
- Sin clave foránea, borrados explícitamente: `monthly_kpi_events` y, si existe, `daily_stats_invalid_dates`.
- Esquema `editorial`, borrado explícito en orden de dependencias: `social_posts`, `publications`, `jobs`, `events`, `contents`, `content_revisions`, `plan_items`, `calendars`, `publishing_accounts`, `research_snapshots`, `legacy_mappings`, `client_settings`.

**Hallazgo que motivó cambios en el código.** Las claves foráneas del esquema `editorial` hacia `publishing_accounts`, `plan_items` y `content_revisions` son `ON DELETE RESTRICT`, y PostgreSQL no garantiza el orden en que se disparan las cascadas desde `public.clients`. Confiar en la cascada podía hacer fallar el borrado de un cliente con contenido. Por eso `deleteClient` borra ahora el esquema `editorial` en orden explícito (sin tocar las migraciones 0004–0008, que están firmadas con checksum). La prueba nueva cubre esa cadena; hasta que se ejecute en CI (`npm run test:db`) el resultado en base de datos real es **no verificado localmente**.

**Qué NO se borra:**

- Todo lo ya publicado fuera de Infidash: entradas en WordPress, publicaciones en Facebook/Instagram/Google Business Profile (Postiz) y filas en Sheets. **Decisión del responsable: se quedan.**
- Ficheros de medios en el disco de Postiz, hasta que se ejecute `npm run postiz:cleanup` (y **para siempre** si lo borras después de borrar el cliente: el script solo toca ficheros referenciados por filas de Infidash, y esas filas ya no existirán; ejecuta la limpieza **antes** de borrar el cliente si te importa liberar sus ficheros).
- Backups existentes: conservan al cliente hasta que rotan (unas 8 semanas con la retención por defecto).
- Logs y el historial de ejecuciones de n8n.
- `editorial.service_tokens` (global; `allowed_client_ids` puede conservar el id del cliente borrado, que no es un dato personal) y `editorial.media_cleanup_log` (URLs y nombres de fichero, sin `client_id`).
- Credenciales ya entregadas a terceros: revoca en el sistema del cliente la contraseña de aplicación de WordPress y el token usado por Infidash, aunque los datos hayan desaparecido de la base.

**Lista de limpieza externa (opcional, sin obligación; el responsable puede hacerla más adelante):**

- [ ] Revocar la contraseña de aplicación de WordPress y las claves de WooCommerce creadas para Infidash.
- [ ] Desactivar o borrar el webhook de Infidash en WP Webhooks (Fluent Forms / Contact Form 7).
- [ ] En Postiz: desconectar los canales del cliente y, si se quiere, borrar sus publicaciones programadas.
- [ ] Ejecutar `npm run postiz:cleanup -- --apply` en el VPS de Postiz para liberar ficheros ya caducados (idealmente **antes** de borrar el cliente; después, sus ficheros ya no están referenciados y el script no los ve, habría que borrarlos a mano en el disco de Postiz).
- [ ] Quitar el acceso de Infidash a la propiedad de GA4 / cuenta de Google Ads / proyecto de Clarity del cliente.
- [ ] Revisar y limpiar Sheets y las ejecuciones antiguas de n8n.
- [ ] Anotar la fecha del borrado y de la limpieza externa en el registro de tratamientos.

## 5. Solicitudes de interesados

Plazo legal de respuesta: **un mes** desde la recepción (art. 12 RGPD, ampliable en casos complejos; a validar por el responsable). Si Infidash actúa como encargado, la solicitud debe canalizarse a través del cliente (el responsable de esos leads).

**Supresión de un lead (por correo):**

1. Verifica la identidad de quien lo pide y registra la solicitud (fecha, cliente, quién la tramita) en el registro del responsable, fuera de Infidash.
2. Simulación: `npm run leads:erase -- --email=persona@ejemplo.com` (añade `--client=<idCliente>` para limitarlo a un cliente). Imprime solo cuántos leads coinciden y sus ids; nunca nombres, correos ni teléfonos. La coincidencia es exacta e insensible a mayúsculas.
3. Si los ids son los esperados, ejecuta lo mismo con `--apply` (y, si quieres, `--note="Solicitud 2026-10-02"`, máximo 200 caracteres; no pongas datos personales en la nota). Borra en una sola transacción.
4. Queda un log estructurado `lead_erasure` con el número de leads, la nota, el cliente y un **prefijo de 12 caracteres del SHA-256 del correo en minúsculas**, nunca el correo.
5. El dato sigue en los backups hasta que rotan (unas 8 semanas). **Si se restaura un backup, hay que repetir las supresiones atendidas desde la fecha de ese backup**; por eso el registro de solicitudes debe llevarse fuera de Infidash (el hash del log no permite reconstruir correos).
6. Pide además al cliente que borre el dato en su WordPress / formulario / Flamingo, que Infidash no controla.
7. Responde a la persona dentro del plazo.

**Acceso o rectificación de un lead:** no existe CLI ni pantalla de edición de leads. Para acceso, un administrador consulta el lead en el panel (Leads) y se entrega a la persona (a través del cliente). Para rectificación, por ahora hay que hacerla con SQL por un administrador de base de datos (decisión abierta, sección 7).

**Usuarios del panel:** el borrado es `DELETE /api/users/:id` (administrador). Se eliminan sus sesiones y membresías; los campos `created_by`/`author_id`/`actor_id` con clave foránea pasan a `NULL`, pero los ids de `monthly_kpi_events.actor_user_id`, `monthly_kpi_cycles.closed_by_user_id` y `reopened_by_user_id` **permanecen** como identificadores sin usuario asociado (seudónimos). La rectificación del nombre o correo es posible desde el panel de usuarios (a confirmar en la interfaz).

## 6. Brecha de seguridad (lista corta)

Plazo: notificar a la AEPD en **72 horas** desde que se tiene constancia si hay riesgo para las personas (art. 33 RGPD; a validar por el responsable). Si Infidash es encargado, avisar al cliente (responsable) sin dilación.

1. **Contener:** revocar sesiones (reiniciar o `DELETE FROM sessions`), rotar `INFIDASH_ADMIN_PASSWORD`, `INFIDASH_CREDENTIALS_KEY` (README, «Rotar la clave»), el token de servicio de n8n y los secretos del webhook (rotar URL desde Integraciones).
2. **Revocar** las credenciales de terceros guardadas (WordPress, WooCommerce, GA4/Ads, Clarity, SMTP, Postiz, OpenAI).
3. **Preservar evidencias:** copia de los logs (`reqId`, IP) y de un backup actual antes de tocar nada.
4. **Evaluar el alcance:** qué tablas/clientes, qué datos (leads, correos de informes, hashes de contraseña), desde cuándo.
5. **Notificar** a los clientes afectados y, si procede, a la AEPD y a las personas.
6. **Anotar** la brecha en el registro (hechos, efectos, medidas) aunque no se notifique.

## 7. Registro de revisión

- **Revisado por:** el responsable — **pendiente de firma**
- **Fecha del borrador:** 2026-10-02
- **Versión del código revisado:** rama `feat/gdpr-retention`

**Decisiones abiertas** (no se han tomado ni se han implementado):

1. Purga de `report_runs` (PDF y `last_sent_to`) y de los snapshots (WooCommerce, GA4, Google Ads, Clarity): plazo y si procede.
2. Plazo de conservación de logs y del historial de ejecuciones de n8n en el host (EasyPanel): hoy no está definido por la aplicación.
3. Programar `postiz:cleanup` (cron en el VPS) y el backup (`INFIDASH_BACKUP_SCHEDULE_HOUR`) si aún no lo están; confirmar copias fuera del servidor y su rotación.
4. Cifrado en reposo: confirmar que `INFIDASH_CREDENTIALS_KEY` está definida en producción; el `webhook_secret` sigue en texto plano.
5. Procedimiento de acceso y rectificación de leads (hoy manual / SQL).
6. Confirmar con los contratos de encargo si Infidash es encargado o corresponsable de los leads, y completar los acuerdos de tratamiento con los terceros de la sección 3.
7. Si `INFIDASH_TRUST_PROXY` está definida en producción (afecta a qué IP registran los logs).
8. Ficheros de Postiz de clientes ya borrados (sin filas que los referencien): decidir si se limpian a mano.
9. Si se quiere borrar también los ids huérfanos de `monthly_kpi_events` al borrar un usuario.
