# Preparación y recuperación editorial

`GET /api/clients/:clientId/editorial-readiness` muestra si la automatización está habilitada y si cada tipo de trabajo tiene un workflow vinculado. Al crear un trabajo o programar una publicación, la API rechaza un cliente deshabilitado o un vínculo ausente antes de insertar en la cola.

El panel de trabajos muestra el historial del cliente. Un administrador puede recuperar un trabajo `generate_plan` que agotó ocho intentos; se reinicia el contador y se registra `job.recovered` en auditoría. Los trabajos `publish`, `reschedule` y `cancel` solo reciben su primer intento automático: si fallan o caduca su reserva, el administrador puede encolar un trabajo `reconcile` para consultar el estado externo. El identificador de idempotencia del trabajo de conciliación evita encolarlo dos veces para el mismo incidente.

La instalación real de n8n, la configuración de cada workflow y la conciliación de una publicación aceptada antes de un timeout requieren verificación en staging. No se modificaron las exportaciones versionadas de `workflows/content/`.
