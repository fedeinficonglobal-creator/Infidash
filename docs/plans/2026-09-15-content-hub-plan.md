# Plan: Contenidos en Infidash y retirada de Google Sheets

Fecha: 2026-09-15  
Estado: listo para revisión; implementación pendiente.  
Origen: petición directa del usuario y análisis de tres workflows de Inficon y del esquema Content Hub.  
Repositorio destino: https://github.com/fedeinficonglobal-creator/Infidash  
Referencia consultada: main; SHA obtenido al finalizar la consulta: e3a97ad074cfd2794b541d204f9db31ca261c697. Revalidar cambios antes de implementar.  
Diseño: MANUAL_DOCUMENTADO. El usuario elige reutilizar Infidash y documentar la UI; Stitch no es requisito para esta ejecución. No se ha generado HTML.  
Agentes: tareas genéricas; no se ha detectado un orquestador en el árbol del repositorio.

## 1. Objetivo y alcance

Eliminar Sheets de los procesos de planificación, generación y publicación de los 15 clientes. Guardar toda la información en PostgreSQL y gestionarla desde una sección «Contenidos» de Infidash, con calendario global y vista por cliente.

Se mantienen inicialmente los tres workflows por cliente: calendario editorial, creación de contenido y envío a Postiz. Se sustituyen sus lecturas/escrituras de Sheets y Content Hub por un contrato común con la API de Infidash. Los prompts, fuentes y credenciales específicos permanecen en cada workflow. La unificación posterior en workflows compartidos es opcional y no condiciona esta migración.

Incluye importar planes e históricos, edición del calendario, revisión de textos, aprobación, seguimiento de WordPress/Postiz, incidencias y trazabilidad. No incluye nuevas capacidades de generación audiovisual, publicación automática sin aprobación ni un portal externo de clientes.

## 2. Evidencia del repositorio y consecuencias

| Evidencia observada | Consecuencia para el plan |
|---|---|
| React 19, Vite 6, TypeScript, Tailwind 4, Zustand 5, date-fns 4, lucide-react | Usar el stack y estilos existentes; no introducir otro framework. Versiones declaradas, no verificadas en producción. |
| App.tsx navega por activeTabId y Sidebar.tsx por botones | Registrar `content` en ambos, sin introducir React Router para esta feature. |
| useClientStore.ts tiene DEFAULT_TABS y activeClientId | Incluir `content` en DEFAULT_TABS; preservar sesión y selección existente. |
| App devuelve AgencyDashboard cuando no hay cliente | Resolver `content` antes de ese retorno para permitir calendario global. |
| server.ts utiliza Fastify | Crear un módulo de rutas Fastify. README aún menciona Express: corregir esa documentación al implementar. |
| src/lib/database.ts contiene tablas e inicialización | No usar src/db/schema.ts como schema activo: actualmente es un placeholder. |
| Acceso actual a PostgreSQL mediante spawnSync('psql') y parámetros interpolados | Añadir un pool asíncrono `pg` y consultas parametrizadas para el módulo editorial y sus transacciones. No ampliar el patrón síncrono. |
| clients.id es TEXT; Content Hub usa INTEGER | Usar los IDs existentes de Infidash y una tabla de correspondencias para los IDs antiguos. No relacionar por nombre en ejecución. |
| Existen integrations, rrss_channels, users y sessions | Reutilizar clientes y autenticación; relacionar canales analíticos con cuentas editoriales sin tratarlos como lo mismo. |
| Roles admin/viewer | Admin edita y ejecuta; viewer consulta. No asumir aislamiento por cliente solo porque existe un filtro de UI. |
| Catálogo sin Postiz ni n8n; WordPress está orientado a leads | Añadir configuración editorial sin romper la integración actual de leads. |

Archivos consultados: package.json, src/App.tsx, src/components/Sidebar.tsx, src/components/DashboardComponents.tsx, src/store/useClientStore.ts, src/services/infidashApi.ts, src/lib/database.ts, src/lib/auth.ts, src/lib/integrationCatalog.ts, server.ts y README.md. No se han ejecutado pruebas del repositorio ni consultado datos del VPS. Solo hay exports de un cliente en el workspace; los otros workflows requieren inventario.

## 3. Arquitectura elegida

```text
Infidash / Contenidos
         ↕ sesión de usuario
API Fastify ───────────── PostgreSQL de Infidash
         ↕ token de servicio        ├ clientes existentes
     n8n: workflows por cliente     └ esquema editorial
         ↕              ↕
      WordPress       Postiz
         └── confirmaciones y reconciliación ──→ API → DB
```

Decisión propuesta: migrar los datos de Content Hub al PostgreSQL utilizado por Infidash, dentro de un esquema `editorial`. La tabla `public.clients` de Infidash será el catálogo canónico. Confirmar base/esquema real del VPS en la fase 0 antes de aplicar migraciones.

Infidash y n8n operarán contra una API común; n8n no duplicará SQL de negocio entre 45 workflows. Los adaptadores externos WordPress/Postiz permanecen en n8n. La API persiste trabajos y n8n los recoge mediante un dispatcher común, que llama al workflow específico configurado para el cliente. Así no se mantienen peticiones de navegador abiertas durante la generación.

La antigua DB se conserva como respaldo de migración, sin escrituras tras el corte. No habrá sincronización bidireccional permanente con Sheets.

## 4. Modelo de datos propuesto

Las tablas nuevas usarán UUID como identificador, client_id TEXT referenciando clients.id, timestamps TIMESTAMPTZ, version INTEGER para control de edición concurrente y JSONB para estructuras variables. Los catálogos de estados tendrán CHECK; el servicio validará las transiciones.

| Tabla nueva en editorial | Campos y propósito |
|---|---|
| client_settings | client_id PK, timezone, language, editorial_config JSONB, workflow bindings de plan/generación/envío, enabled. Referencias a workflows y credenciales, no secretos en respuestas públicas. |
| calendars | id, client_id, start_date, end_date, title, version, status, summary, insights JSONB, created_by, created_at. Un cliente puede tener varios periodos/versiones. |
| plan_items | id, client_id, calendar_id, title, theme, rationale, format, keyword_primary, keywords JSONB, entities JSONB, cta, priority, planned_at nullable, status, source_context JSONB, source_key, version. |
| contents | id, client_id, plan_item_id nullable, title, body_html, body_text, excerpt, seo JSONB, status, current_revision, created_at, updated_at. Plan opcional para históricos independientes. |
| content_revisions | id, client_id, content_id, revision_number, content_snapshot JSONB, prompt_version, source_references JSONB, author_type, author_id, created_at. Regenerar crea revisión y no destruye la aprobada. |
| publishing_accounts | id, client_id, provider (wordpress/postiz), instance_key, external_account_id, platform, label, timezone, rrss_channel_id nullable, integration_id nullable, active. Una cuenta concreta o sitio, no solo «Instagram» o «GMB». |
| publications | id, client_id, content_id, account_id, occurrence_key, content_revision_id, copy, media JSONB, status, desired_scheduled_at, confirmed_scheduled_at, postiz_post_id, provider_post_id, external_url, published_at, last_synced_at, error_code, error_message, version. |
| jobs | id, client_id, kind, target_id, idempotency_key, status, attempt_count, next_attempt_at, lease_token, locked_until, execution_id, payload JSONB, result JSONB, last_error, timestamps. |
| events | id, client_id, entity_type, entity_id, event_type, source_event_id, payload filtrado JSONB, actor_id, occurred_at, received_at. Auditoría y deduplicación de callbacks. |
| legacy_mappings | source_system, source_entity, source_id, target_id, client_id, imported_at, source_hash. Conservar equivalencias de clientes, artículos, publicaciones y filas. |
| research_snapshots | id, client_id, source, period_start, period_end, fetched_at, payload JSONB, status. Sustituye también las hojas auxiliares de competidores e histórico. |

Restricciones:

- UNIQUE de trabajos por client_id + idempotency_key, devolviendo el mismo trabajo ante doble clic/reentrega.
- UNIQUE de publicaciones por content_id + account_id + occurrence_key. V1 usa una ocurrencia principal; una republicación debe ser explícita.
- Identificador de WordPress único dentro de su sitio/cuenta; ID de Postiz dentro de su instancia. Aplicar índices únicos parciales a IDs externos no nulos.
- FK compuestas con client_id para impedir relaciones entre planes, contenidos, cuentas y publicaciones de clientes distintos.
- Índices en plan_items(client_id, planned_at), publications(client_id, status, desired_scheduled_at) y jobs(status, next_attempt_at).
- El estado agregado de una pieza se calcula a partir de sus salidas; una publicación fallida no convierte en fallidas las que ya están publicadas.
- Mantener `planned_at = NULL` para filas sin fecha interpretable. Mostrar «Sin fecha» y excluirlas del envío automático.
- Los recursos grandes se mantienen en almacenamiento de archivos/WordPress y se guardan URL y metadatos; no binarios/base64 en las tablas.

## 5. Estados y reglas

### Plan editorial

`proposed → approved → generating → review → ready`, con `generation_failed` y `archived`.

### Publicación por cuenta

`pending → sending → scheduled → published`, con `failed`, `unknown`, `cancel_requested`, `cancelled` y `draft` para WordPress.

- Un borrador de WordPress se registra como draft, nunca published.
- La aceptación de Postiz se registra como scheduled y requiere guardar su identificador; published solo tras confirmación verificable.
- Una expiración de conexión tras un envío puede significar éxito externo: pasar a unknown y reconciliar antes de reenviar.
- La reserva del trabajo es transaccional y tiene caducidad y token; una ejecución antigua no puede sobrescribir el resultado de una nueva.
- La aprobación fija la revisión que puede distribuirse. Editar/regenerar contenido ya aprobado exige nueva revisión y aprobación.
- Si un artículo depende de WordPress, su publicación social espera a que el artículo tenga URL pública confirmada.
- Las fechas se guardan como instantes UTC y se presentan en la zona del cliente; validar cambios de horario de verano e instantes ambiguos.
- Cambiar una fecha ya programada crea un trabajo de actualización externa. Mostrar fecha deseada y confirmada hasta que Postiz confirme.
- Los callbacks fuera de orden no pueden degradar published a scheduled; deduplicar por evento y contrastar con estado externo ante conflictos.
- Un éxito limpia el error activo pero conserva el historial.

## 6. API y contratos con n8n

Rutas orientativas, implementadas en un plugin Fastify con schemas de validación y respuestas homogéneas:

| Ruta | Uso |
|---|---|
| GET /api/content/summary | Contadores por estado y filtro; distinguir piezas de publicaciones. |
| GET /api/content/calendar?clientId=&from=&to=&status=&format=&cursor= | Calendario global/cliente con límites, filtros y paginación. |
| GET/POST /api/clients/:clientId/editorial-calendars | Consultar/crear periodo editorial. |
| GET/POST/PATCH /api/content/plan-items[/:id] | Crear, leer y editar propuestas; version requerida en PATCH. |
| GET/PATCH /api/content/items/:id | Detalle y edición de contenido. |
| POST /api/content/items/:id/approve | Aprobar una revisión concreta. |
| POST /api/content/jobs | Solicitar generación de plan, contenido, programación, cambio de fecha, cancelación o reconciliación; devuelve 202 + jobId. |
| GET /api/content/jobs/:id | Estado y error operativo. |
| GET /api/content/items/:id/publications | Salidas, fechas, URLs e incidencias. |
| POST /api/internal/content/jobs/claim | n8n reserva trabajo de forma atómica. |
| POST /api/internal/content/jobs/:id/heartbeat | Renovar reserva durante llamadas largas de IA. |
| POST /api/internal/content/jobs/:id/result | Resultado validado e idempotente: plan, revisión o respuesta de publicación. |
| GET /api/internal/content/clients/:clientId/context | Configuración editorial, histórico y planes existentes; no sesión humana. |
| POST /api/internal/content/events | Eventos verificados de WordPress/Postiz y reconciliación. |
| POST /api/internal/content/research | Guardar snapshots y sustituir hojas auxiliares. |

Ejemplo de trabajo de generación:

```json
{
  "schemaVersion": 1,
  "jobId": "uuid",
  "clientId": "id-existente-de-infidash",
  "kind": "generate_content",
  "planItemId": "uuid",
  "expectedVersion": 3,
  "idempotencyKey": "generate:plan-item-uuid:revision-3"
}
```

Auth humana: reutilizar sesiones; escritura solo admin, lectura viewer/admin conforme al ámbito de acceso validado. En el MVP se asumen usuarios internos de agencia; si existen viewers de clientes, incorporar membresías de cliente antes de habilitar la sección para ellos.

Auth máquina: tokens de servicio independientes de las sesiones, con scopes y clientes permitidos, almacenados con hash y rotables. Dispatcher con permiso de claim y credencial separada de callbacks. Nunca exponer tokens ni URLs privadas de ejecución al navegador. No permitir que un token limitado elija arbitrariamente otro clientId.

Errores: 400 validación, 401/403 acceso, 404 recurso no accesible, 409 revisión obsoleta/transición incompatible. Un reintento con la misma clave y distinto payload se rechaza; una repetición idéntica devuelve el resultado anterior.

## 7. Cambios de los workflows

### Calendario editorial: por cada cliente

1. Cargar contexto por clientId desde la API.
2. Sustituir lectura del calendario de Sheets por planes y publicaciones reales, separados por estado.
3. Sustituir hojas auxiliares de competidores por research_snapshots.
4. Mantener fuentes específicas: GA4, Search Console, SerpAPI, Apify y rankings según cliente.
5. Corregir referencias a nodos inexistentes y el ejemplo JSON inválido del prompt.
6. Validar salida estructurada, fechas, formatos y campos; un fallo no se convierte en una fila vacía de éxito.
7. Guardar calendario y propuestas en una transacción mediante el endpoint de resultado. Deduplicar la reentrega de ese trabajo; una nueva versión de plan es una acción distinta.
8. Completar job y mostrar el resultado en Infidash.

### Creación de contenido: por cada cliente

1. Recibir planItemId/jobId reservado; abandonar lecturas de filas preparadas por título.
2. Generar y persistir revisión y metadatos antes de cualquier escritura externa.
3. Crear/actualizar borrador WordPress con sitio e identificador estables; preservar aprobación actual por cliente.
4. Registrar draft y URL de edición, vincular contenido y plan.
5. Sustituir Actualizar Terminado en Sheets por resultado en API.
6. Manejar error por trabajo para que un fallo no deje todos los clientes bloqueados.
7. Validar HTML y sanearlo al mostrarlo en Infidash; no confiar en HTML generado o importado.

### Envío a Postiz: por cada cliente

1. Validar webhook WordPress y resolver cuenta/sitio + ID de artículo.
2. No identificar cliente por nombre ni por un ID WordPress global.
3. Seleccionar salidas aprobadas con fecha y cuenta válidas. No usar ahora + 5 minutos como sustituto del calendario.
4. Reservar publicación; comprobar clave de operación y revisión aprobada.
5. Corregir `Webhook inficon1` y verificar contrato real del nodo Postiz instalado, incluidos postId, formatos de error, imágenes y fechas.
6. Guardar programación e identificador externo. Texto de red específico; no repetir título como descripción.
7. Reconciliar antes de reintentar cualquier resultado ambiguo. No afirmar garantía de exactamente una publicación si el proveedor no ofrece idempotencia.

### Workflows comunes nuevos

- Dispatcher: recoge trabajos de la API y ejecuta el workflow autorizado de cada cliente; concurrencia limitada y sin monopolio de un cliente.
- Reconciliación: consulta publicaciones en espera/desconocidas, detecta publicación, error, cancelación y cambios manuales en Postiz; webhooks cuando la versión instalada lo permita.
- Importación: utilitario temporal y repetible, desactivado tras la migración.

Reconciliación inicial propuesta cada 5 minutos para pendientes, con límites y backoff adaptados a la API instalada. La UI muestra la última comprobación real y avisa cuando los datos están desactualizados.

## 8. Diseño de la sección Contenidos

Mantener light mode, tipografía, colores brand, bordes y espaciado de Infidash. Usar iconos lucide existentes. No añadir dependencias visuales grandes para la primera versión.

### Navegación

- Entrada global «Contenidos» accesible sin cliente seleccionado.
- Entrada en menú de cada cliente con el mismo componente filtrado.
- Resolver la sección antes del fallback de AgencyDashboard.
- Mantener filtros por vista; abortar respuestas antiguas al cambiar cliente y advertir cambios sin guardar.

### Distribución visual

```text
Contenidos                           [Nuevo contenido] [Generar plan]
[Cliente / Todos] [Periodo] [Formato] [Estado] [Buscar]
Piezas propuestas | En revisión | Programaciones | Publicadas | Incidencias
[Calendario] [Lista] [Incidencias]            Actualizado hace …
---------------------------------------------------------------
Calendario mensual / agenda móvil o tabla paginada
---------------------------------------------------------------
Panel de detalle: Brief | Contenido | Publicaciones | Historial
```

El calendario distingue fecha editorial de salidas programadas mediante un selector de modo. Las piezas sin fecha aparecen en una bandeja aparte. Contadores indican explícitamente si cuentan piezas o publicaciones; no inventar tendencias porcentuales.

### Componentes

| Requisito | Componente | Estado | Acción |
|---|---|---|---|
| Navegación y cliente activo | Sidebar, App, useClientStore | Existe | Ampliar `content` y modo global. |
| Cliente con búsqueda entre 15 opciones | ContentFilters | Nuevo | Selector buscable; fechas, formato, estado y texto. |
| Resumen operativo | ContentSummary | Nuevo | Reutilizar estilos de cards; MetricCard actual presupone comparación temporal y no encaja directamente. |
| Calendario mensual | EditorialCalendar | Nuevo | date-fns para rejilla; conversión de zona explícita y agenda en móvil. |
| Lista masiva | ContentTable | Nuevo | Paginación, ordenación, selección y etiquetas accesibles. |
| Detalle/edición | ContentDetailPanel | Nuevo | Brief, editor inicial de texto/HTML con preview saneado, medios, versiones y acciones por rol. |
| Estados por destino | PublicationList | Nuevo | Cuenta, fecha deseada/confirmada, estado, URL y error. |
| Historial | ContentTimeline | Nuevo | Acciones humanas, generación y eventos de proveedor. |
| Indicadores | ContentStatusBadge | Nuevo | Texto e icono además de color. |
| Carga y errores | Estado local del módulo | Patrón existente | Skeleton, vacío, sin resultados, sin fecha, error recuperable, conflicto de edición y sincronización pendiente. |

Acciones v1: crear/editar propuesta, generar plan, generar/regenerar contenido, aprobar revisión, programar, solicitar cambio/cancelación y reintentar fallos confirmados. Mantener el envío mediante n8n. Posponer drag-and-drop y editor enriquecido avanzado; fecha editable por formulario y contenido con preview son suficientes para retirar Sheets.

## 9. Fases y entregables

### Fase 0 — Inventario y contrato (1–2 jornadas orientativas)

- [ ] Revalidar main e instrucciones del repo; registrar commit de implementación.
- [ ] Inventariar workflows de los 15 clientes, hojas de calendario y auxiliares, columnas, credenciales y formatos.
- [ ] Comprobar versiones de n8n/Postiz, respuesta real del nodo y mecanismos de confirmación.
- [ ] Determinar ubicación de ambas DB y mapear 15 clientes, sitios y cuentas; ninguna asociación automática solo por nombre.
- [ ] Determinar usuarios internos/externos, reglas actuales de aprobación y fecha de corte por cliente.
- [ ] Definir contratos JSON versionados y matriz de transformación; registrar particularidades por cliente.

Salida: inventario completo, mapa de clientes/cuentas y contratos listos. El plan no depende de tener estos datos ahora; ejecutar la migración sí.

### Fase 1 — Persistencia y migraciones (2–3 jornadas)

- [ ] Crear migraciones versionadas con registro schema_migrations, lock de migración y ejecución única de despliegue.
- [ ] Añadir pool pg asíncrono, cierre ordenado, consultas parametrizadas y transacciones del módulo.
- [ ] Crear tablas/índices/FK, estados y repositorio de contenidos; conservar tablas existentes de Infidash.
- [ ] Preparar importador dry-run, mappings, hashes, informe de conflictos y reconciliación de recuentos.
- [ ] Probar migraciones y restauración en copia de PostgreSQL.

### Fase 2 — API y trabajos (2–3 jornadas)

- [ ] Añadir rutas, validadores, autorizaciones humanas y tokens de servicio.
- [ ] Implementar transiciones, idempotencia, reserva con lease, heartbeat y resultados transaccionales.
- [ ] Registrar auditoría, límites de consulta y redacción de secretos en errores/logs.
- [ ] Probar contratos con callbacks simulados; ninguna llamada pública desde el navegador.

### Fase 3 — Página Contenidos (2–4 jornadas)

- [ ] Añadir navegación, DEFAULT_TABS y componente global/cliente.
- [ ] Implementar filtros, lista, resumen, calendario y bandeja sin fecha.
- [ ] Implementar detalle, edición, aprobación y seguimiento de trabajos/publicaciones.
- [ ] Añadir carga bajo demanda; polling solo de vista activa, con pausa al ocultar pestaña y sin peticiones superpuestas.
- [ ] Verificar accesibilidad, móvil, permisos y preview seguro.

### Fase 4 — Piloto Inficon (2–3 jornadas)

- [ ] Crear versiones migradas de los tres workflows y dispatcher/reconciliación.
- [ ] Importar Inficon en staging y revisar borradores, estados ambiguos y fechas.
- [ ] Validar ciclo completo incluyendo publicación externa controlada, fallo y reintento.
- [ ] Activar para Inficon tras prueba del corte y recuperación; observar un ciclo operativo completo.

### Fase 5 — Migración de otros 14 clientes (3–5 jornadas según diferencias)

- [ ] Migrar por lotes pequeños, primero clientes representativos de formatos/canales distintos.
- [ ] Por cliente: congelar ediciones de Sheets, esperar trabajos activos, importar delta y verificar registros.
- [ ] Desactivar triggers antiguos antes de activar sus reemplazos; habilitar una única ruta de escritura.
- [ ] Verificar equivalencias, contenido, cuentas, fechas y programaciones existentes.
- [ ] Retirar todos los nodos Sheets del recorrido activo, también los de investigación/competidores.
- [ ] Conservar Sheets como archivo histórico; terminar operación diaria exclusivamente en Infidash.

### Fase 6 — QA final y documentación (1–2 jornadas)

- [ ] Completar aceptación de los 15 clientes y suite de regresión del repo.
- [ ] Documentar despliegue, tokens, backups, importaciones y recuperación de publicaciones ambiguas.
- [ ] Dejar panel de incidencias y última sincronización verificables.

Estimación total orientativa: 13–22 jornadas de implementación; no es un compromiso de calendario. La variación principal son las diferencias entre los 45 workflows, calidad de fechas y posibilidades de la versión instalada de Postiz. Incluye la página operativa, no solo visualización.

## 10. Importación y corte sin pérdida de información

| Origen | Destino / transformación |
|---|---|
| Sheets: Semana, Tema_Semana, Justificacion, Dia, Titulo, Formato, Canal, Keywords, CTA, Prioridad, Fuente_Dato, Estado, Fecha, identities | calendars + plan_items; columnas específicas de otros clientes se inventarían en fase 0. |
| Fecha de generación de fila | created_at/origen; nunca interpretarla automáticamente como fecha prevista. |
| Semana/día sin periodo inequívoco | planned_at NULL y revisión manual; no inferir una programación pasada/futura. |
| preparado | approved para generación, salvo regla distinta documentada del cliente. |
| publicado en Sheets | Estado legado sin confirmación hasta verificar WordPress; puede ser un draft por el workflow actual. |
| clients integer de Content Hub | Correspondencia explícita a clients TEXT de Infidash. |
| articles | contents + publications WordPress; recuperar cuerpo/metadatos ausentes desde WP si corresponde. |
| article_publications | publications; separar ID Postiz de ID de red, reconciliar scheduled/published. |
| content_plan | plan_items; evitar duplicación con filas ya importadas mediante mappings revisados. |
| Publicaciones en Postiz sin artículo asociado | Importar como contenido histórico independiente; no fabricar relación con un artículo por coincidencia de título. |

Snapshots de Sheets deben incluir ID de documento, hoja y un ID estable por fila. Si no existe ID, asignarlo en un manifiesto congelado y conservar row_number como procedencia, no como identidad permanente. Nueva extracción tras reordenar filas requiere conciliar el manifiesto. Importaciones repetidas del mismo snapshot no duplican registros.

Las publicaciones ya programadas en Postiz se importan y se sincronizan; no se crean de nuevo. Si un envío antiguo no tiene ID identificable, queda en revisión/unknown y no se republica automáticamente.

Rollback por cliente: pausar trabajos nuevos, drenar ejecuciones y exportar estado/delta. Reconciliar trabajos ya enviados con WordPress/Postiz antes de reactivar cualquier flujo antiguo. Restaurar una DB no revierte publicaciones externas. Evitar restauraciones destructivas de toda Infidash si basta desactivar la feature del cliente; mantener el historial nuevo para recuperación.

## 11. Pruebas y aceptación

| ID | Criterio verificable |
|---|---|
| AC-01 | Los 15 clientes tienen correspondencia única; una cuenta, plan o contenido de otro cliente es rechazado por API y FK. |
| AC-02 | Reimportar el mismo snapshot no cambia recuentos ni duplica publicaciones; conflictos y filas omitidas aparecen en informe. |
| AC-03 | Tras el corte no existen lecturas/escrituras Sheets en los recorridos activos de planificación, investigación, generación ni publicación. |
| AC-04 | Generar plan guarda calendario y piezas visibles en Infidash; JSON inválido termina como fallo sin plan parcial. |
| AC-05 | Editar propuesta en Infidash modifica la entrada del siguiente trabajo n8n; edición simultánea obsoleta devuelve 409. |
| AC-06 | Doble clic o dos workers sobre el mismo trabajo producen una única reserva efectiva y el mismo resultado persistido. |
| AC-07 | Crear borrador WordPress muestra draft; programar Postiz muestra scheduled y solo confirmación muestra published. |
| AC-08 | Dos sitios con post ID 123 conservan sus publicaciones independientes. |
| AC-09 | Timeout tras aceptación de Postiz pasa a unknown; reconciliación recupera resultado sin reenvío ciego. |
| AC-10 | Caída de worker y vencimiento de lease permiten recuperación; callback antiguo no pisa resultado nuevo. |
| AC-11 | Fechas se muestran/envían correctamente con cambio horario Europe/Madrid; sin fecha no se programa. |
| AC-12 | Publicación parcial: una red publicada y otra fallida se muestran separadas; solo se reintenta la fallida. |
| AC-13 | Cambio/cancelación en Postiz se refleja tras sincronización; UI muestra cuándo se comprobó por última vez. |
| AC-14 | Viewer no puede editar/aprobar/ejecutar; token de servicio no accede a clientes ni acciones fuera de su ámbito. |
| AC-15 | Vista global y por cliente tienen filtros, paginación, vacío/error/carga y no muestran respuesta vieja al cambiar cliente. |
| AC-16 | Preview no ejecuta scripts de contenido importado; navegador/logs no reciben secretos de integraciones. |
| AC-17 | Regenerar conserva la revisión aprobada y no cambia una publicación programada sin acción explícita. |
| AC-18 | Se prueba corte/recuperación con delta y publicaciones externas; los datos existentes del dashboard no se pierden. |

Pruebas unitarias: estados, fechas, normalización e idempotencia. Integración con PostgreSQL real aislado: FK, transacciones y concurrencia (no sustituir por mocks en estos casos). Fastify inject para contratos y permisos; pruebas de UI del ciclo de edición y selección. Staging para nodo real n8n/Postiz. Ejecutar `npm run lint`, `npm run test` y `npm run build`, tal como declara el repo. No se han ejecutado porque este entregable es un plan.

## 12. Archivos previstos en Infidash

Rutas nuevas propuestas, no archivos ya existentes:

```text
docs/plans/2026-09-15-content-hub-plan.md
docs/content-workflows.md
docs/content-migration.md
src/components/ContentTab.tsx
src/components/content/{ContentFilters,ContentSummary,EditorialCalendar,ContentTable,ContentDetailPanel,PublicationList,ContentTimeline,ContentStatusBadge}.tsx
src/services/contentApi.ts
src/store/useContentStore.ts
src/lib/content/{types,validation,transitions,dates}.ts
src/server/content/{routes,repository,jobs,serviceAuth,postgres}.ts
db/migrations/*_editorial_*.sql
scripts/{migrate-editorial,import-content-hub}.ts
tests/content-*.test.ts
workflows/content/{client-key}/{plan,generate,publish}.json
workflows/content/{dispatcher,reconcile}.json
```

Modificar: src/App.tsx, src/components/Sidebar.tsx, src/store/useClientStore.ts, server.ts (registrar rutas/cerrar pool), package.json y lockfile (pg y scripts), .env.example y README.md. Reutilizar apiRequest de infidashApi.ts. Extender integrationCatalog.ts y sus tipos/UI solo si se decide mostrar la configuración de Postiz/n8n en Integraciones; las referencias de ejecución editoriales pueden vivir en client_settings sin copiar secretos.

Los exports versionados de workflows deben eliminar secretos embebidos y datos de ejecuciones/pinData. Conservar solo placeholders y referencias de credencial que se resuelven en despliegue.

## 13. Decisiones y alternativas

| Decisión | Elección | Motivo / coste |
|---|---|---|
| Persistencia principal | Esquema editorial en DB Infidash | Un catálogo de clientes y consultas locales; requiere migrar Content Hub y validar infraestructura real. |
| Dos DB sincronizadas permanentemente | No como objetivo | Multiplica discrepancias y resolución de identidad; mantener la antigua solo durante transición. |
| Integración n8n | API común + trabajos durables | Reglas uniformes y autenticación verificable; añade un dispatcher y disponibilidad de API. |
| Organización workflows | Mantener por cliente inicialmente | Retirar Sheets sin reescribir todos los prompts; consolidar después si compensa. |
| Acceso nuevo a DB | pg asíncrono parametrizado | Permite concurrencia/transacciones sin bloquear Fastify; convive temporalmente con acceso legado. |
| UI | Reutilizar Infidash | Elección expresa del usuario; diseños documentados en este plan. |
| Tiempo real | Polling acotado inicialmente | Suficiente para operación editorial; mostrar retraso real, SSE opcional posterior. |
| Usuarios externos | Fuera del supuesto inicial | Si existen, implementar membresías y aislamiento antes de dar acceso. |

## 14. Datos a resolver antes de ejecutar

- Exports restantes y configuración de los 15 calendarios; no se presume que sean idénticos a Inficon.
- Ubicación, permisos y esquema real de PostgreSQL de Infidash y Content Hub.
- Mapa de clientes, sitios WordPress, cuentas Postiz e IDs de workflows.
- Versión instalada de n8n, nodo comunitario y Postiz; posibilidades reales de consultar estados/callbacks.
- Regla de aprobación de cada cliente y usuarios que accederán a Contenidos.

Primer entregable de implementación recomendado: migraciones + API + lista/detalle de Contenidos con Inficon en staging; después generación y programación, y finalmente corte gradual de los 15 clientes.

## Referencias

- Repositorio: https://github.com/fedeinficonglobal-creator/Infidash
- Navegación: https://github.com/fedeinficonglobal-creator/Infidash/blob/main/src/App.tsx
- Persistencia actual: https://github.com/fedeinficonglobal-creator/Infidash/blob/main/src/lib/database.ts
- API: https://github.com/fedeinficonglobal-creator/Infidash/blob/main/server.ts
- Documentación Postiz consultada durante el análisis previo: https://docs.postiz.com/public-api/posts/create y https://docs.postiz.com/public-api/posts/list . Contrastar con la versión del VPS durante el piloto.

Este plan está guardado en el workspace de análisis. No se ha subido al repo, alterado el VPS ni modificado los workflows de producción.
