# Workflows editoriales n8n

Los exports de `workflows/content` son la base versionada y sanitizada del piloto de Inficon Global. Se importan desactivados, no contienen credenciales, IDs de instalaciones, datos fijados de ejecuciones ni nodos de Google Sheets. No se han conectado a n8n, WordPress o Postiz desde este repositorio.

## Qué está incluido

| Export | Responsabilidad |
|---|---|
| `dispatcher.v1.json` | Reserva un trabajo con lease, obtiene el binding autorizado, renueva el lease y espera a que termine el workflow hijo. |
| `inficon-global/plan.v1.json` | Ejecuta las fuentes y agentes del export original (Trends, GA4, Search Console, Apify, rankings e IA), normaliza el plan y entrega `planItems`. |
| `inficon-global/generate.v1.json` | Ejecuta investigador, redactor, humanizador y WordPress; crea un borrador, registra `draft` y entrega una revisión. |
| `inficon-global/publish.v1.json` | Exige una fecha ISO-8601, ejecuta el nodo Postiz real y registra `scheduled`; clasifica rechazos y resultados ambiguos. |
| `reconcile.v1.json` | Consulta la API real de Postiz por intervalo, contrasta el ID y registra `scheduled`, `published`, `failed`, `cancelled` o `unknown`. |

Los tres exports de cliente contienen los nodos externos reales de los exports fuente. Se han retirado triggers antiguos, SQL directo, Sheets, backfill, credenciales e IDs de instalación. Las referencias rotas `calendario editorial2` y `Webhook inficon1` ya no existen. Los workflows toman el trabajo reservado y el contexto de Infidash, y escriben exclusivamente mediante `result` y `events`.

## Configurar los nodos existentes de Inficon

Conservar una copia inactiva de cada export original durante el montaje. Los nodos ya están conectados, pero sus credenciales se eliminan deliberadamente del JSON:

1. En `plan.v1`, enlazar credenciales de OpenAI, GA4, Search Console y Apify. La configuración editorial procede de `editorial.client_settings`; SerpAPI, Serprobot y GA4 usan variables de entorno. Revisar los actores Apify disponibles en la instancia antes de activar.
2. En `generate.v1`, enlazar OpenAI, SerpAPI y WordPress. El artículo se toma del `planItem` del trabajo/contexto y WordPress queda fijado a `draft`.
3. En `publish.v1`, enlazar la credencial Postiz del nodo comunitario. La cuenta, copy, medio y fecha proceden del trabajo y del contexto; no existe `now + 5 minutos`.
4. En `reconcile.v1`, configurar la URL y token de la API de Postiz. El normalizador admite las colecciones `posts`, `data`, `items` o un array, pero debe contrastarse con la versión instalada.

Cada operación externa larga renueva el lease antes y después. Las ramas de error confirmado terminan el trabajo como `failed`. En publicación, un 4xx determinista se considera rechazo; timeout, 408, 409, 429, error de red o respuesta sin confirmación terminan como `unknown` y exigen reconciliación antes de reenviar.

## Contrato autosaneable de trabajos

- `generate_plan` siempre recibe un `target_id` que identifica un calendario existente. Si quien llama no aporta uno, la API crea el calendario dentro de la misma transacción y añade `payload.calendarId` y `payload.calendar_id`; el child workflow exige que los tres valores coincidan.
- `publish`, `reschedule`, `cancel` y `reconcile` no confían en un payload del navegador. Al crear y al reclamar un trabajo, Infidash vuelve a leer `publications` y `publishing_accounts` y escribe `payload.publication` completo. Incluye las variantes camelCase y snake_case de cuenta, fecha deseada, copy, media, IDs de Postiz/proveedor y datos de cuenta. Esto hace que un reintento use los datos persistidos y sanee los trabajos heredados incompletos.
- Una ambigüedad de WordPress (timeout, red o 5xx) termina como `unknown` con `reconcileRequired`. La propuesta permanece en `generating`, por lo que no se puede abrir otro trabajo de generación y duplicar el borrador hasta revisar/reconciliar el resultado. Los fallos confirmados sí permanecen reintentables.

## Configuración de staging

1. Importar los cinco JSON y dejarlos inactivos.
2. Configurar en n8n `INFIDASH_INTERNAL_API_URL` y `INFIDASH_SERVICE_TOKEN`. El token debe tener solo los scopes y clientes necesarios: `jobs:claim`, `jobs:result`, `context:read` y `events:write`.
3. Configurar `SERPAPI_API_KEY`, `SERPROBOT_API_URL`, `SERPROBOT_API_KEY`, `SERPROBOT_PROJECT_ID`, `GA4_PROPERTY_ID_INFICON`, `POSTIZ_INTERNAL_API_URL` y `POSTIZ_API_KEY`. Configurar `fallbackImageUrl` en `editorial_config` si alguna publicación puede llegar sin medio. Conectar credenciales de OpenAI, analítica, WordPress y Postiz desde el almacén de credenciales de n8n. No escribirlas en nodos Set/Code ni exportarlas.
4. Importar `clients.example.json` a la configuración operativa mediante un script de despliegue propio. Resolver las variables de entorno a IDs reales y guardar `workflow_bindings` en `editorial.client_settings`. El ejemplo está deshabilitado y contiene solo Inficon; no representa a los otros 14 clientes.
5. Ejecutar manualmente cada child workflow con un trabajo de prueba y una base de staging. Verificar evento, resultado, expiración de lease y repetición idempotente.
6. Activar primero los children, luego el dispatcher. Desactivar triggers antiguos antes de habilitar el nuevo dispatcher. Mantener una sola ruta de escritura.

Las fuentes y proveedores principales tienen salida de error conectada. Antes del piloto también se debe enlazar un Error Workflow global de n8n para fallos del propio motor, de un heartbeat o de la API de Infidash. Un fallo de infraestructura puede impedir registrar el resultado; en ese caso el lease vence y otro worker recupera el trabajo.

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
