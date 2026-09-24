# Cierre de KPI mensuales

El ciclo de cada cliente se cierra el **día 25 a las 00:00, hora de Europe/Madrid**. `src/lib/monthlyCloseClock.ts` calcula el instante UTC correcto incluso con horario de verano. El proceso recupera los meses vencidos después de una parada y limita cada tanda a diez ciclos; reintenta mientras queden pendientes.

La ejecución automática está **desactivada por defecto**. Después de verificarla con PostgreSQL desechable y en staging, configura `INFIDASH_MONTHLY_AUTO_CLOSE=1` en el entorno del servidor. No se necesita un cron externo. No actives el flag en producción sin esa validación; en este equipo no hay PostgreSQL desechable para ejecutar las pruebas de integración.

El cierre es por **cliente y mes**, no por fila. `POST /api/monthly-kpis/:id/close` (administrador) cierra todas las filas del ciclo de forma idempotente, guarda un evento y snapshot de cada fila modificada y prepara el mes siguiente con los mismos objetivos, sin valores reales ni estado heredado. Las escrituras de un mes cerrado responden `409 MONTHLY_KPI_CLOSED`. `GET /api/clients/:clientId/monthly-kpi-cycles` permite consultar los ciclos.

Para corregir un ciclo, un administrador llama a `POST /api/monthly-kpis/:id/reopen` con `{ "reason": "Motivo de la corrección" }`. Reabre todas las filas y registra actor, fecha, motivo y snapshot; el cierre automático no vuelve a cerrarlo. Tras la corrección, debe cerrarse manualmente de nuevo. `GET /api/monthly-kpis/:id/events` muestra el historial de una fila al administrador.

**Validación pendiente:** ejecutar `npm run test:db` y `npm run test:api` contra PostgreSQL aislado, incluyendo cierres concurrentes y caída/reinicio. Sin esas pruebas, la implementación no es una certificación de producción.
