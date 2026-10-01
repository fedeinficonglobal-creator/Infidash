# Workflows editoriales n8n

Los exports de `workflows/content` son la base versionada y sanitizada del piloto de Inficon Global. Se importan desactivados, no contienen credenciales, IDs de instalaciones, datos fijados de ejecuciones ni nodos de Google Sheets. No se han conectado a n8n, WordPress o Postiz desde este repositorio.

## Qué está incluido

| Export | Responsabilidad |
|---|---|
| `dispatcher.v1.json` | Reserva un trabajo con lease, obtiene el binding autorizado, renueva el lease (1800 s) y espera a que termine el workflow hijo. Solo un 204 significa "sin trabajo": cualquier otra respuesta de la reserva distinta de 200 con `job` hace fallar la ejecución de forma visible. Si falla el binding, el contexto, la renovación o el hijo, informa el trabajo como `failed` (`stage: dispatcher`) en lugar de esperar a que venza el lease. |
| `inficon-global/plan.v1.json` | Ejecuta las fuentes y agentes del export original (Trends, GA4, Search Console, JINA, rankings e IA), normaliza el plan y entrega `planItems`. Las fuentes son opcionales: el error de una fuente, su procesado o su agente produce un análisis `unavailable` (nodos `Sin datos: …`) en la misma entrada del merge. Solo el núcleo secuencial (contexto, heartbeats, síntesis final y normalización) informa `failed`. |
| `inficon-global/generate.v1.json` | Ejecuta investigador, redactor, humanizador y WordPress; crea un borrador, registra `draft` (evento sobre el `plan_item`) y entrega una revisión. Los fallos antes de WordPress son `failed`; un error del propio nodo WordPress se clasifica como ambiguo (`unknown`) o rechazo; cualquier fallo posterior es `unknown` e incluye `wordpressPostId`. |
| `inficon-global/publish.v1.json` | Exige una fecha ISO-8601, valida cuenta, copy y URL de GMB (`Validar publicacion`) antes de generar la imagen, ejecuta el nodo Postiz de la red correspondiente y registra `scheduled`; clasifica rechazos y resultados ambiguos. Los fallos antes de Postiz son `failed`; cualquier fallo posterior es `unknown` (`POST_WRITE_FAILURE`) con el `postizPostId` si se conoce. |
| `inficon-global/reschedule.v1.json` | Borra la publicación anterior en Postiz y crea otra en la nueva fecha (Postiz no tiene endpoint de actualización). Mismo enrutado de fallos que `publish`: `failed` antes de escribir en Postiz y `unknown` después. |
| `inficon-global/cancel.v1.json` | Borra la publicación en Postiz (un 404 cuenta como ya cancelada). Los fallos son `failed` salvo que el DELETE ya se haya ejecutado; entonces son `unknown` con el `postizPostId`. |
| `reconcile.v1.json` | Consulta la API real de Postiz por intervalo, contrasta el ID y registra `scheduled`, `published`, `failed`, `cancelled` o `unknown`. Sin `postizPostId` no consulta Postiz: cierra la publicación como `failed` (`POSTIZ_ID_MISSING`) para comprobarla y reenviarla. Sus fallos se informan como `failed` y se reintentan sin tocar el estado de la publicación. |
| `rrss-plan.v1.json` | Compartido por todos los clientes (`generate_rrss_plan`). Lee `payload.rrss` y `editorial_config` (sin valores de cliente), consulta Google Trends y la estacionalidad en SerpAPI y las ideas existentes del contexto, y propone `postsPerWeek × weeksHorizon` ideas de redes con formato y redes. Las fuentes degradan a `Sin datos: …`; el núcleo informa `failed`. |
| `rrss-generate.v1.json` | Compartido por todos los clientes (`generate_rrss`). Escribe un texto por red con una sola llamada a OpenAI y, si `payload.generateImage` no es `false`, una imagen IA nueva por cuenta subida a Postiz. Devuelve un borrador `socialPosts` por cuenta para revisarlo en Infidash. Cualquier fallo de imagen deja el post sin medio; el resto de fallos son `failed`. |

Los exports de cliente contienen los nodos externos reales de los exports fuente. Se han retirado triggers antiguos, SQL directo, Sheets, backfill, credenciales e IDs de instalación. Las referencias rotas `calendario editorial2` y `Webhook inficon1` ya no existen. Los workflows toman el trabajo reservado y el contexto de Infidash, y escriben exclusivamente mediante `result` y `events`.

## Configurar los nodos existentes de Inficon

Conservar una copia inactiva de cada export original durante el montaje. Los nodos ya están conectados, pero sus credenciales se eliminan deliberadamente del JSON:

1. En `plan.v1`, enlazar credenciales de OpenAI, GA4, Search Console y Apify. La configuración editorial procede de `editorial.client_settings`; SerpAPI, Serprobot y GA4 usan variables de entorno. Revisar los actores Apify disponibles en la instancia antes de activar.
2. En `generate.v1`, enlazar OpenAI, SerpAPI y WordPress. El artículo se toma de `job.payload.planItem` (construido por Infidash) y, solo si falta, del contexto; WordPress queda fijado a `draft`.
3. En `publish.v1`, enlazar la credencial Postiz del nodo comunitario. La cuenta, copy, medio y fecha proceden del trabajo y del contexto; no existe `now + 5 minutos`.
4. En `reconcile.v1`, configurar la URL y token de la API de Postiz. El normalizador admite las colecciones `posts`, `data`, `items` o un array, pero debe contrastarse con la versión instalada.

Cada operación externa larga renueva el lease antes y después. Las ramas de error confirmado terminan el trabajo como `failed`. En publicación, un 4xx determinista se considera rechazo; timeout, 408, 409, 429, error de red o respuesta sin confirmación terminan como `unknown` y exigen reconciliación antes de reenviar.

## Workflows de redes sociales (compartidos)

`rrss-plan.v1.json` y `rrss-generate.v1.json` no dependen del cliente: se importan una sola vez y el mismo ID de workflow se guarda como binding de todos los clientes. El pipeline de redes es independiente del blog: el plan del blog (`plan.v1`) solo propone artículos y el contexto separa `planItems` (ideas del blog) de `rrssPlanItems` (ideas de redes).

- **`generate_rrss_plan`** (`rrss-plan.v1`): `Validar trabajo` → `Heartbeat inicial` (1800 s) → `Cargar contexto Infidash` → `⚙️ Configuración RRSS`. El tema sale de `payload.rrss.topic`, `editorial_config.rrss.topic` o `editorial_config.topic` (sin tema falla); las redes son obligatorias; `postsPerWeek` vale 3 y `weeksHorizon` 4 por defecto. Las tres fuentes (Trends, estacionalidad e ideas existentes) son opcionales. `🤖 IA: Plan de Redes` → `📝 Parsear Plan JSON` → `Heartbeat tras IA` → `Normalizar resultado del plan RRSS` filtra redes y formatos, data cada idea desde `periodStart` y usa `sourceKey` `rrss-plan:<job>:<n>`.
- **`generate_rrss`** (`rrss-generate.v1`): `Validar trabajo` → `Heartbeat antes de IA` (1500 s) → `Cargar contexto Infidash` → `Preparar posts` → `🤖 IA: Textos por red` → `Parsear textos` → `Un item por cuenta` → bucle `Recorrer cuentas` (una cuenta por iteración) → `¿Generar imagen?` → `Generar imagen IA` → `Convertir imagen a binario` → `Subir imagen a Postiz` → `Preparar post`. Con `generateImage: false` el bucle salta la cadena de imagen. Los errores de los tres nodos de imagen llegan a `Preparar post` sin medio. Al terminar el bucle: `Agregar posts` → `Heartbeat tras IA` (600 s) → `Normalizar resultado RRSS` → `Guardar resultado Infidash`. Subir una imagen a Postiz no publica nada, así que todos los fallos son `failed`.

Después de importar, enlazar:

1. La credencial nativa de OpenAI («OpenAi account») en `OpenAI — Análisis` y `OpenAI — Plan de Redes` (plan) y en `OpenAI — Textos por red` (posts).
2. La credencial Postiz del nodo comunitario en `Subir imagen a Postiz`.
3. Las imágenes usan la misma llamada HTTP que `generate.v1`/`publish.v1`, con la cabecera `Authorization: Bearer $env.OPENAI_API_KEY` y sin credencial de n8n.

Variables de entorno del servicio n8n: `INFIDASH_INTERNAL_API_URL`, `INFIDASH_SERVICE_TOKEN` (scopes `jobs:claim`, `jobs:result` y `context:read` para los clientes que usen redes), `SERPAPI_API_KEY` y `OPENAI_API_KEY`. Para cada cliente con redes, añadir a `editorial.client_settings.workflow_bindings` las claves `generate_rrss_plan` y `generate_rrss` con los IDs de estos dos workflows, y configurar `editorial_config.rrss` (tema, keywords, redes, publicaciones por semana) y `brandName`.

## Contrato autosaneable de trabajos

- `generate_plan` siempre recibe un `target_id` que identifica un calendario existente. Si quien llama no aporta uno, la API crea el calendario dentro de la misma transacción y añade `payload.calendarId` y `payload.calendar_id`; el child workflow exige que los tres valores coincidan.
- `publish`, `reschedule`, `cancel` y `reconcile` no confían en un payload del navegador. Al crear y al reclamar un trabajo, Infidash vuelve a leer `publications` y `publishing_accounts` y escribe `payload.publication` completo. Incluye las variantes camelCase y snake_case de cuenta, fecha deseada, copy, media, IDs de Postiz/proveedor y datos de cuenta. Esto hace que un reintento use los datos persistidos y sanee los trabajos heredados incompletos.
- `generate_plan` también recibe `payload.periodStart` (YYYY-MM-DD): la fecha indicada, el inicio del calendario existente o el próximo lunes. Un calendario nuevo se crea con ese inicio y un fin de `editorial_config.weeksHorizon` semanas (4 por defecto).
- `generate_content` recibe `payload.planItem` completo (título, tema, justificación, formato, keywords, entidades, CTA, prioridad, fecha y versión) leído de la base de datos al crear y al reclamar el trabajo; el payload del navegador se ignora.
- Mientras exista un trabajo equivalente activo (pendiente, con lease vigente o fallido que aún se reintenta solo), crear otro devuelve `409 JOB_IN_PROGRESS`. Para `publish`, `reschedule` y `cancel` un intento fallido no cuenta como activo porque nunca se reintenta automáticamente.
- Una ambigüedad de WordPress (timeout, red o 5xx) termina como `unknown` con `reconcileRequired`. La propuesta permanece en `generating`, por lo que no se puede abrir otro trabajo de generación y duplicar el borrador. Tras revisar WordPress, un administrador usa «Marcar como fallida» (`POST /api/content/plan-items/:id/release-generation`): la propuesta pasa a `generation_failed` y los trabajos `generate_content` pendientes, fallidos, caducados o `unknown` quedan congelados para que no se reclamen ni apliquen. Los fallos confirmados sí permanecen reintentables.
- `cancel.v1.json` y `reschedule.v1.json` (inficon-global) tienen el mismo enrutado de errores que el resto de workflows. La interfaz solo muestra cada acción cuando `editorial-readiness` indica un binding para ese tipo.

## Configuración de staging

1. Importar los cinco JSON y dejarlos inactivos.
2. Configurar en n8n `INFIDASH_INTERNAL_API_URL` y `INFIDASH_SERVICE_TOKEN`. El token debe tener solo los scopes y clientes necesarios: `jobs:claim`, `jobs:result`, `context:read` y `events:write`.
3. Configurar `SERPAPI_API_KEY`, `SERPROBOT_API_URL`, `SERPROBOT_API_KEY`, `SERPROBOT_PROJECT_ID`, `GA4_PROPERTY_ID_INFICON`, `POSTIZ_INTERNAL_API_URL` y `POSTIZ_API_KEY`. Configurar `fallbackImageUrl` en `editorial_config` si alguna publicación puede llegar sin medio. Conectar credenciales de OpenAI, analítica, WordPress y Postiz desde el almacén de credenciales de n8n. No escribirlas en nodos Set/Code ni exportarlas.
4. Importar `clients.example.json` a la configuración operativa mediante un script de despliegue propio. Resolver las variables de entorno a IDs reales y guardar `workflow_bindings` en `editorial.client_settings`. El ejemplo está deshabilitado y contiene solo Inficon; no representa a los otros 14 clientes.
5. Ejecutar manualmente cada child workflow con un trabajo de prueba y una base de staging. Verificar evento, resultado, expiración de lease y repetición idempotente.
6. Activar primero los children, luego el dispatcher. Desactivar triggers antiguos antes de habilitar el nuevo dispatcher. Mantener una sola ruta de escritura.

Todos los nodos que pueden fallar tienen salida de error conectada a una rama que informa a Infidash (o, en el plan, a un análisis de sustitución). Si el propio informe de fallo no llega (por ejemplo `LEASE_LOST`), la ejecución termina en error de forma deliberada. Antes del piloto también se debe enlazar un Error Workflow global de n8n para fallos del propio motor. Los tests de `tests/content-workflows.test.ts` ejecutan el `jsCode` de estos nodos con datos simulados, pero no sustituyen una prueba en n8n.

## Datos pendientes para completar el piloto

- ID canónico de Inficon en `public.clients` y correspondencia con el Content Hub anterior.
- IDs importados de los workflows de staging y cuentas WordPress/Postiz.
- Forma exacta de la respuesta del nodo Postiz instalado (`postId`, errores, consulta de estado y cancelación).
- Reglas de aprobación, zona horaria confirmada y horas editoriales de Inficon.
- Credenciales de staging y comprobación de que los nodos comunitarios/actores conservan el mismo contrato en la versión instalada.
- Token de servicio creado con hash mediante el procedimiento de despliegue y URL interna alcanzable desde n8n.

No activar el piloto hasta completar esos datos y probar un borrador, una programación futura, un resultado ambiguo y una reconciliación. Una restauración de base de datos no revierte una publicación externa.

## Escalado a 15 clientes

`clients.schema.json` define un manifiesto reutilizable por cliente. Añadir un cliente solo después de inventariar sus exports, cuentas y reglas reales; no duplicar Inficon cambiando el nombre. Cada entrada debe permanecer `enabled: false` hasta superar el mismo ciclo de staging. El dispatcher usa los bindings guardados en la API y evita una lista de clientes codificada en el workflow.
