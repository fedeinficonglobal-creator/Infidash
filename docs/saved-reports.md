# Reportes guardados y envío SMTP

El administrador puede guardar un PDF de métricas diarias para un cliente y periodo (máximo 367 días). El archivo queda conservado en `report_runs` y una descarga posterior obtiene el mismo PDF aunque cambien las métricas. Los lectores con acceso al cliente pueden descargarlo; solo los administradores pueden crearlo o enviarlo.

Configure `REPORT_SMTP_HOST`, `REPORT_SMTP_PORT`, `REPORT_SMTP_FROM` y, si el servidor exige autenticación, `REPORT_SMTP_USER` y `REPORT_SMTP_PASSWORD`. El puerto 465 usa TLS implícito; los demás exigen STARTTLS. Mantenga la contraseña en el gestor de secretos del despliegue. La interfaz deshabilita el envío mientras falte configuración.

El envío es manual. Tras cada intento se guarda el destinatario y el resultado. Si SMTP devuelve un error o pierde la conexión, Infidash marca la entrega como no confirmada: el operador debe comprobar el buzón antes de reenviar para evitar duplicados. No hay envíos programados ni integración con Notion.

La tabla nueva se crea con la inicialización habitual del esquema principal. Los PDF se almacenan como base64 en PostgreSQL; conviene incluir `report_runs` en la política de copias y retención. No almacene destinatarios ni documentos fuera de la política de datos del cliente.
