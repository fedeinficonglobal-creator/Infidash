# Workflows editoriales n8n

Los exports de `workflows/content` son la base versionada y sanitizada del piloto de Inficon Global. Se importan desactivados, no contienen credenciales, IDs de instalaciones, datos fijados de ejecuciones ni nodos de Google Sheets. No se han conectado a n8n, WordPress o Postiz desde este repositorio.

## Qué está incluido

| Export | Responsabilidad |
|---|---|
| `dispatcher.v1.json` | Reserva un trabajo con lease, obtiene el binding autorizado del cliente y ejecuta el workflow correspondiente. |
| `inficon-global/plan.v1.json` | Obtiene el contexto, valida un plan y entrega `planItems` al endpoint idempotente de resultado. |
| `inficon-global/generate.v1.json` | Obtiene contexto, valida el contenido, registra el borrador WordPress como `draft` y entrega una revisión. |
| `inficon-global/publish.v1.json` | Exige una fecha ISO-8601 del calendario, valida cuenta y respuesta de Postiz, y registra `scheduled`. |
| `reconcile.v1.json` | Convierte una consulta verificable a Postiz en `scheduled`, `published`, `failed`, `cancelled` o `unknown`, registra el evento y termina el trabajo. |

Los tres exports de cliente son armazones de contrato importables. Se eligió esta forma porque copiar automáticamente los exports de producción habría conservado referencias de nodos rotas, credenciales ligadas a la instancia y supuestos de Sheets. Cada adaptador falla de forma explícita mientras no reciba la salida de sus nodos externos; no crea éxitos vacíos.

## Incorporar los nodos existentes de Inficon

Conservar una copia inactiva de cada export original durante el montaje. En staging:

1. En `plan.v1`, insertar entre **Cargar contexto Infidash** y **Validar plan IA** las fuentes y nodos IA del antiguo `Plan de Contenidos — Inficon global`. Eliminar todos los nodos Google Sheets. Sustituir `calendario editorial2` por los datos de contexto de Infidash y terminar con un array en `job.payload.planItems` o adaptar el nodo validador a la salida IA real. Mantener las fuentes GA4, Search Console, Apify, rankings y tendencias solo después de volver a enlazar sus credenciales en n8n.
2. En `generate.v1`, insertar el investigador, redactor, humanizador, limpieza HTML y WordPress del antiguo `Blog Inficon global`. La entrada es el `target_id` y el contexto, no una fila buscada por título. El nodo WordPress debe crear o actualizar un borrador y entregar `generatedContent` y `wordpressDraft`; nunca marcarlo como publicado.
3. En `publish.v1`, insertar el nodo Postiz del antiguo `Envio a Inficon blog` antes de **Normalizar respuesta Postiz**. Usar la cuenta del contexto, el copy de la publicación y `desiredScheduledAt`. Entregar `providerResult.postId`. No conservar la referencia inexistente `Webhook inficon1`, consultas SQL directas ni el backfill histórico.
4. En `reconcile.v1`, insertar la consulta compatible con la versión instalada de Postiz antes de **Normalizar estado externo** y producir `providerState`. Solo usar `published` cuando la respuesta externa incluya evidencia y `publishedAt`.

Para una conexión visual más simple, los nodos adaptadores actuales leen los datos simulables desde `job.payload`. Al incorporar cada rama externa, cambiar únicamente la primera línea `raw/provider = ...` para leer la salida del nodo anterior. Mantener sin cambios el objeto final enviado a los endpoints de Infidash.

## Configuración de staging

1. Importar los cinco JSON y dejarlos inactivos.
2. Configurar en n8n `INFIDASH_INTERNAL_API_URL` y `INFIDASH_SERVICE_TOKEN`. El token debe tener solo los scopes y clientes necesarios: `jobs:claim`, `jobs:result`, `context:read` y `events:write`.
3. Conectar credenciales de OpenAI, analítica, WordPress y Postiz desde el almacén de credenciales de n8n. No escribirlas en nodos Set/Code ni exportarlas.
4. Importar `clients.example.json` a la configuración operativa mediante un script de despliegue propio. Resolver las variables de entorno a IDs reales y guardar `workflow_bindings` en `editorial.client_settings`. El ejemplo está deshabilitado y contiene solo Inficon; no representa a los otros 14 clientes.
5. Ejecutar manualmente cada child workflow con un trabajo de prueba y una base de staging. Verificar evento, resultado, expiración de lease y repetición idempotente.
6. Activar primero los children, luego el dispatcher. Desactivar triggers antiguos antes de habilitar el nuevo dispatcher. Mantener una sola ruta de escritura.

El armazón deja que una excepción venza el lease para que otro worker recupere el trabajo. Antes del piloto se debe enlazar un Error Workflow de n8n que envíe `status: failed` al endpoint de resultado cuando el fallo sea definitivo; así la interfaz no espera a que caduque el lease. Los timeouts posteriores a una petición a Postiz deben terminar como `unknown` y pasar por reconciliación, no por reenvío automático.

## Datos pendientes para completar el piloto

- ID canónico de Inficon en `public.clients` y correspondencia con el Content Hub anterior.
- IDs importados de los workflows de staging y cuentas WordPress/Postiz.
- Forma exacta de la respuesta del nodo Postiz instalado (`postId`, errores, consulta de estado y cancelación).
- Reglas de aprobación, zona horaria confirmada y horas editoriales de Inficon.
- Salida real de los nodos IA y fuentes para adaptar los tres puntos marcados arriba.
- Token de servicio creado con hash mediante el procedimiento de despliegue y URL interna alcanzable desde n8n.

No activar el piloto hasta completar esos datos y probar un borrador, una programación futura, un resultado ambiguo y una reconciliación. Una restauración de base de datos no revierte una publicación externa.

## Escalado a 15 clientes

`clients.schema.json` define un manifiesto reutilizable por cliente. Añadir un cliente solo después de inventariar sus exports, cuentas y reglas reales; no duplicar Inficon cambiando el nombre. Cada entrada debe permanecer `enabled: false` hasta superar el mismo ciclo de staging. El dispatcher usa los bindings guardados en la API y evita una lista de clientes codificada en el workflow.
