# Webhooks de formularios WordPress

Infidash recibe un `POST` JSON en la URL secreta mostrada en **Leads → Configurar Webhooks**. En WP Webhooks, usa el disparador **Form submitted** de Fluent Forms o Contact Form 7 y envía al menos un campo reconocible (`name`, `email`, `phone` o `message`, incluidos los nombres habituales de CF7). No publiques la URL ni incluyas datos de prueba reales.

Para que un reintento no cree otro lead, configura estos tres campos **en el cuerpo JSON**:

| Campo | Fluent Forms | Contact Form 7 |
| --- | --- | --- |
| `infidash_provider` | `fluent_forms` | `contact_form_7` |
| `infidash_form_id` | ID estable del formulario | ID estable del formulario |
| `infidash_delivery_id` | ID real del envío, no del contacto | Número/ID estable del envío |

Fluent Forms documenta `{submission.id}` como ID único de entrada. Comprueba en la prueba de WP Webhooks que llega **resuelto** (por ejemplo, `501`), nunca el texto literal `{submission.id}`. Para Contact Form 7, WP Webhooks permite añadir *special mail tags*; `[_serial_number]` solo está disponible con Flamingo 1.5+. Si no hay un ID estable, deja los tres campos `infidash_*` ausentes: el lead se acepta, pero **no se deduplica**. Nunca uses email, nombre, mensaje ni hash del contenido como ID; dos envíos legítimos pueden ser idénticos.

Los campos `infidash_*` deben venir de la configuración del flujo de WP Webhooks, no de campos editables por quien rellena el formulario. Comprueba el JSON real de ambos disparadores: WP Webhooks permite seleccionar o personalizar el payload, pero la estructura exacta depende del flujo configurado.

Un POST nuevo devuelve `201`; un reintento con el mismo identificador, `200` y `duplicate: true`, conservando el ID original. La deduplicación se separa por integración, proveedor y formulario. El administrador puede desactivar la captura o rotar la URL; la antigua deja de funcionar. Verifica con un envío ficticio y repite exactamente el mismo POST antes de usarlo en producción.

Referencias: [WP Webhooks: Fluent Forms](https://wp-webhooks.com/integrations/fluent-forms/triggers/fluent_form_submitted/), [WP Webhooks: Contact Form 7](https://wp-webhooks.com/integrations/contactform7/triggers/cf7_forms/), [Fluent Forms: ID del envío](https://fluentforms.com/docs/shortcodes-in-confirmation-settings/), [Contact Form 7: número de serie y Flamingo](https://contactform7.com/special-mail-tags/).
