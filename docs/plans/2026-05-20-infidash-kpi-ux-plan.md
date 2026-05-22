# Infidash KPI / Análisis UX Plan de Implementación

> **Para Hermes:** implementar este plan paso a paso con verificación en cada bloque.

**Objetivo:** convertir Infidash en un panel operativo para la agencia con KPIs manuales y automáticos por departamento: Publicidad, Web, RRSS y Análisis/UX; dejando SEO fuera del MVP.

**Arquitectura:** el backend seguirá siendo Express + Postgres puro. La app guardará configuración, objetivos y cierres mensuales en la base de datos. Las métricas automáticas llegarán por integraciones (Meta Ads, Google Ads, WordPress/WooCommerce y Clarity para UX), mientras que los objetivos y cierres mensuales serán editables desde el administrador. Para soportar comparativas 7/14/30 días, se persistirán snapshots diarios en Postgres. La sección de Clarity no se llamará Clarity en la UI: se mostrará como **Análisis/UX** o nombre equivalente más genérico.

**Tech Stack:** React + TypeScript, Express/tsx, Drizzle, Postgres, React Query / store actual, Vitest, browser verification.

---

## Decisiones cerradas antes de implementar

1. **Publicidad no depende de Clarity** para métricas de campañas.
   - Meta Ads debe venir de Meta.
   - Google Ads debe venir de Google Ads.
   - Clarity puede complementar UX post-clic, pero no sustituye la fuente de Ads.
2. **Web** mostrará leads y ventas con umbrales mensuales manuales.
3. **RRSS** debe permitir redes variables por cliente, creadas manualmente.
4. **Cierre RRSS**: se registra manualmente y el flujo se revisa/cierra cada día 25.
5. **SEO** queda fuera del MVP.
6. **La etiqueta visible en la UI** será **Análisis/UX** (no “Clarity”).

---

## Mapa funcional del MVP

### Departamento: Publicidad
- Métricas automáticas:
  - Meta Ads
  - Google Ads
- KPI manual fijo por cliente
- Comparativa actual vs objetivo
- Estado visual: éxito / en riesgo / fracaso

### Departamento: Web
- Leads
- Ventas
- KPI mensual objetivo definido manualmente
- KPI conseguido del mes
- Comparativa con mes anterior
- Porcentaje de mejora/caída

### Departamento: RRSS
- Redes sociales configurables manualmente por cliente
- KPI objetivo distinto por red y cliente
- KPI conseguido mensual
- Registro persistente en BBDD
- Actualización manual cada mes con cierre el día 25

### Departamento: Análisis/UX
- Métricas de comportamiento y UX procedentes de Clarity
- Resumen de tráfico / engagement / scroll / errores / fricción
- Filtros por custom tags e identificadores
- Histórico propio para comparativas de 7/14/30 días

---

## Modelo de datos propuesto

> Los nombres son orientativos; la implementación debe ajustarse a los patrones ya existentes en `src/db/schema.ts` y `src/lib/database.ts`.

### 1) `departments`
**Propósito:** catálogo de áreas operativas de cada cliente.

Campos:
- `id` (text, PK)
- `key` (text, unique) — `advertising`, `web`, `rrss`, `ux`, `seo`
- `label` (text) — “Publicidad”, “Web”, “RRSS”, “Análisis/UX”, “SEO”
- `description` (text, null)
- `isEnabled` (boolean)
- `createdAt`, `updatedAt`

### 2) `client_departments`
**Propósito:** qué áreas están activas para cada cliente.

Campos:
- `id`
- `clientId`
- `departmentKey`
- `isEnabled`
- `sortOrder`
- `createdAt`, `updatedAt`

### 3) `kpi_definitions`
**Propósito:** objetivos manuales configurables por cliente y departamento.

Campos:
- `id`
- `clientId`
- `departmentKey`
- `metricKey` — por ejemplo `meta_ads_leads`, `google_ads_cost`, `web_leads`, `web_sales`, `rrss_instagram`, `rrss_tiktok`
- `label`
- `targetType` — `number` | `text`
- `targetValue` (numeric, null)
- `targetText` (text, null)
- `unit` (text, null) — leads, ventas, €, %, sesiones, etc.
- `periodicity` — por defecto `monthly`
- `isActive`
- `createdByUserId`
- `createdAt`, `updatedAt`

### 4) `kpi_monthly_records`
**Propósito:** valor conseguido del KPI por mes.

Campos:
- `id`
- `kpiDefinitionId`
- `clientId`
- `monthKey` — formato `YYYY-MM`
- `actualValue` (numeric, null)
- `actualText` (text, null)
- `status` — `success` | `warning` | `fail` | `unknown`
- `differenceValue` (numeric, null)
- `differencePct` (numeric, null)
- `notes` (text, null)
- `closedAt` (text, null)
- `updatedByUserId`
- `createdAt`, `updatedAt`

### 5) `rrss_channels`
**Propósito:** redes creadas manualmente por cliente.

Campos:
- `id`
- `clientId`
- `platformKey` (text, null) — `instagram`, `facebook`, `tiktok`, `linkedin`, `youtube`, etc.
- `label` (text) — nombre visible de la red
- `isActive` (boolean)
- `sortOrder`
- `createdAt`, `updatedAt`

### 6) `rrss_channel_monthly_kpis`
**Propósito:** KPI objetivo y conseguido por red y por mes.

Campos:
- `id`
- `channelId`
- `clientId`
- `monthKey`
- `targetText` (text)
- `achievedText` (text)
- `status` — `success` | `warning` | `fail` | `unknown`
- `notes` (text, null)
- `closedAt` (text, null)
- `updatedByUserId`
- `createdAt`, `updatedAt`

### 7) `analytics_snapshots`
**Propósito:** guardar históricos de UX/Clarity para comparativas de 7/14/30 días.

Campos:
- `id`
- `clientId`
- `snapshotDate`
- `source` — `clarity`
- `metricKey`
- `metricLabel`
- `dimension1` / `dimension2` / `dimension3` (text, null)
- `valueNumber` (numeric, null)
- `valueText` (text, null)
- `payloadJson` (text)
- `createdAt`, `updatedAt`

### 8) `ad_platform_daily_stats`
**Propósito:** métricas diarias de publicidad por fuente.

Campos:
- `id`
- `clientId`
- `platform` — `meta_ads` | `google_ads`
- `statDate`
- `campaignId` (text, null)
- `campaignName` (text, null)
- `impressions` (integer)
- `clicks` (integer)
- `cost` (numeric)
- `conversions` (integer)
- `leads` (integer)
- `sales` (integer)
- `ctr` (numeric, null)
- `cpc` (numeric, null)
- `cpa` (numeric, null)
- `roas` (numeric, null)
- `payloadJson` (text)
- `createdAt`, `updatedAt`

### 9) Extensión de `daily_stats` existente
Si se prefiere no duplicar tabla, `daily_stats` puede seguir siendo la capa agregada de negocio para web/leads/ventas, pero el plan debe dejar claro qué viene de integración y qué es manual.

---

## Pantallas a construir o adaptar

### A. Resumen de cliente
Ruta sugerida: la pestaña actual del cliente en `src/components/OverviewTab.tsx` o una nueva vista resumen.

Debe mostrar:
- bloque Publicidad
- bloque Web
- bloque RRSS
- bloque Análisis/UX
- estado por área
- KPIs manuales vs conseguidos
- comparativa mes actual vs mes anterior

### B. Administración de KPIs
Nuevo panel dentro de ajustes.

Debe permitir:
- crear KPI manual por cliente y departamento
- elegir tipo numérico o texto
- definir periodicidad mensual
- activar/desactivar
- editar umbral

### C. Administración RRSS
Nuevo panel dentro de ajustes.

Debe permitir:
- añadir red social manualmente
- seleccionar cliente
- definir KPI objetivo textual
- registrar KPI conseguido textual
- cerrar mes
- listar histórico por meses

### D. Análisis/UX
Renombrar la integración actual de Clarity en la UI.

Debe mostrar:
- resumen general UX
- sesiones / engagement / scroll / fricción / errores
- segmentos por custom tags
- lista de sesiones filtradas por identificador
- comparativas 7/14/30 días

### E. Administración de integraciones
Ampliar `src/components/IntegrationsTab.tsx` para diferenciar:
- Meta Ads
- Google Ads
- WordPress
- WooCommerce
- Análisis/UX

---

## APIs backend necesarias

### Configuración / administración
- `GET /api/clients/:clientId/kpis`
- `POST /api/clients/:clientId/kpis`
- `PUT /api/kpis/:kpiId`
- `GET /api/clients/:clientId/rrss-channels`
- `POST /api/clients/:clientId/rrss-channels`
- `PUT /api/rrss-channels/:channelId`
- `POST /api/kpis/:kpiId/close-month`
- `POST /api/clients/:clientId/close-rrss-month`

### Datos automáticos
- `POST /api/sync/meta-ads/:clientId`
- `POST /api/sync/google-ads/:clientId`
- `POST /api/sync/clarity/:clientId`
- `POST /api/sync/wordpress/:clientId`
- `POST /api/sync/woocommerce/:clientId`

### Lectura de dashboard
- `GET /api/clients/:clientId/dashboard/summary`
- `GET /api/clients/:clientId/dashboard/monthly-comparison?month=YYYY-MM`
- `GET /api/clients/:clientId/ux/summary?range=7|14|30`

---

## Lógica de cálculo

### Estado de KPI
- **success**: iguala o supera el objetivo
- **warning**: está cerca del objetivo pero no llega
- **fail**: queda por debajo del umbral
- **unknown**: no hay dato todavía

### Comparativa mensual
- diferencia absoluta = actual - objetivo
- porcentaje de mejora = `(actual - previo) / previo * 100`
- si el valor previo es 0, mostrar `N/A` o `+∞` solo si tiene sentido de negocio

### Web
Ejemplo de cálculo a mostrar:
- Umbral leads: 5
- Leads mes actual: 10
- Resultado: Éxito
- Mes pasado: 4
- Mejora: +150%

### RRSS
- cada red se evalúa por separado
- el registro mensual se edita manualmente
- el día 25 se guarda el cierre del mes anterior o del ciclo vigente según la política que se decida

### Análisis/UX
- guardar snapshots diarios propios porque Clarity solo cubre una ventana corta
- usar custom tags / identify como claves de segmentación, no como sustituto de históricos

---

## Automatización del día 25

### Qué debe hacer
- verificar qué KPIs de RRSS están abiertos
- preparar cierre mensual
- congelar el dato del mes
- crear el nuevo registro del mes siguiente si aplica
- dejar trazabilidad de quién cerró y cuándo

### Dónde viviría
- job cron del backend
- o tarea programada por el servidor
- con posibilidad de ejecución manual desde el panel admin

### Recomendación
- implementar una tarea interna en `server.ts` o un módulo `src/jobs/monthlyClose.ts`
- registrar cada cierre en una tabla de auditoría si ya existe, o crear una nueva si no existe

---

## Naming / UX

### En la UI no usar “Clarity” como título principal
Usar uno de estos:
- **Análisis/UX**
- **Analítica UX**
- **Comportamiento y UX**

### En integraciones técnicas
Sí puede mantenerse la palabra Clarity en el backend o en la configuración interna, pero no como nombre visible principal.

---

## Archivos que probablemente habrá que tocar

### Backend / modelo
- `src/db/schema.ts`
- `src/lib/database.ts`
- `server.ts`
- `src/services/infidashApi.ts`
- `tests/api-regression.test.ts`
- `tests/...` nuevos tests de cálculo y cierres

### UI
- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/components/IntegrationsTab.tsx`
- `src/components/OverviewTab.tsx`
- `src/components/AgencyDashboard.tsx`
- crear nuevos componentes para:
  - `KpiAdminTab.tsx`
  - `RrssAdminTab.tsx`
  - `UxAnalyticsTab.tsx`
  - `DepartmentSettingsTab.tsx`

### Estado / dominio
- `src/store/useClientStore.ts`
- `src/lib/clientSignals.ts`
- `src/lib/integrationCatalog.ts`
- quizá `src/lib/kpiThresholds.ts` para ampliar estados y categorías

---

## Pruebas necesarias

### Unitarias
- cálculo de estados KPI
- cálculo de porcentajes de mejora
- cierre mensual RRSS
- normalización de redes y KPIs
- parsing de snapshots UX

### Regresión API
- crear/editar/listar KPI manuales
- crear/editar redes RRSS
- cerrar mes
- leer dashboard consolidado

### Verificación visual
- acceso desde admin
- sección Análisis/UX visible con nombre genérico
- secciones de Publicidad, Web y RRSS visibles en el cliente
- formularios de creación y edición funcionando

### Build / calidad
- `npm run lint`
- `npm run test`
- `npm run build`

---

## Orden recomendado de ejecución

1. Ajustar esquema y modelos de datos.
2. Crear endpoints backend para KPI manual y RRSS.
3. Implementar cálculo de estados y comparativas.
4. Añadir cierre mensual automático del día 25.
5. Renombrar Clarity a Análisis/UX en la UI.
6. Exponer pantallas de administración.
7. Añadir tests.
8. Validar con navegador y build final.

---

## Riesgos y notas

- **Google Ads no sale de Clarity**: si el negocio quiere métricas de Google Ads, habrá que conectarlo directamente.
- Clarity solo da ventana corta de exportación, así que el histórico de 7/14/30 días debe guardarse en nuestra propia base.
- RRSS necesita flexibilidad por cliente, así que no conviene modelarlo como lista fija de redes.
- Los KPIs manuales deben poder ser textos y números, porque no todos los objetivos son cuantificables igual.
- SEO queda reservado para una fase posterior.

---

## Siguiente paso práctico
Implementar primero:
1. `src/db/schema.ts`
2. `src/lib/database.ts`
3. `server.ts`
4. `src/services/infidashApi.ts`
5. tests de cálculo y cierre mensual

Después, montar la UI de administración y el resumen por cliente.
