# Auditoría final: Contenidos sin Sheets

**Rama:** `feature/contenidos-sin-sheets`
**Commit revisado:** `9862bf0`
**Veredicto:** 🟡 **CONDITIONAL GO** para revisión de código; no habilita el corte de producción.

## Evidencia local

- `npx tsx --test tests/content-api.test.ts tests/content-persistence.test.ts tests/content-ui.test.ts tests/content-workflows.test.ts`: **32/32** pruebas superadas.
- `npm run lint`: superado.
- `npm run build`: superado. Vite informa únicamente del tamaño del bundle principal.

La revisión confirma aislamiento por cliente, migraciones con FK e índices, importación idempotente, permisos humanos y de servicio, leases de trabajos, estados de publicación, UI paginada y sin vista HTML insegura, y exports n8n sin Sheets ni secretos.

## Correcciones verificadas

- `generate_plan` crea un calendario durable si no recibe uno y lo fija en `targetId` y en el contrato del trabajo.
- Las operaciones de publicación, reintento y reconciliación obtienen el snapshot de cuenta/publicación desde la base de datos antes de enviarlo a n8n.
- Una respuesta ambigua de WordPress cambia a `unknown` y exige reconciliación, evitando repetir a ciegas la creación del borrador.

## Antes del corte

1. Ejecutar migraciones y pruebas de concurrencia sobre PostgreSQL de staging.
2. Incorporar los catorce exports y los mapeos de clientes que no estaban disponibles en el directorio recibido.
3. Importar los workflows desactivados en n8n y configurar secretos mediante variables/credenciales del VPS.
4. Realizar una prueba real de Postiz/WordPress, incluida una respuesta de timeout y su reconciliación.
