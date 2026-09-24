import { createHash } from 'node:crypto';

export type LeadFormProvider = 'fluent_forms' | 'contact_form_7';

export interface LeadDeliveryIdentity {
  provider: LeadFormProvider;
  formId: string;
  deliveryId: string;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function normalizeIdentifier(value: unknown): string | null {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : value;
  return typeof normalized === 'string' && identifierPattern.test(normalized) ? normalized : null;
}

export function readLeadDeliveryIdentity(payload: Record<string, unknown>): LeadDeliveryIdentity | null {
  const provider = payload.infidash_provider;
  const deliveryId = payload.infidash_delivery_id;
  const formId = payload.infidash_form_id;
  if (provider === undefined && deliveryId === undefined && formId === undefined) return null;
  if (provider !== 'fluent_forms' && provider !== 'contact_form_7') {
    throw new Error('infidash_provider debe ser fluent_forms o contact_form_7');
  }
  const normalizedDeliveryId = normalizeIdentifier(deliveryId);
  if (!normalizedDeliveryId) {
    throw new Error('infidash_delivery_id debe ser un identificador de envío válido');
  }
  const normalizedFormId = normalizeIdentifier(formId);
  if (!normalizedFormId) {
    throw new Error('infidash_form_id debe ser un identificador de formulario válido');
  }
  return { provider, formId: normalizedFormId, deliveryId: normalizedDeliveryId };
}

export function leadDedupeKey(identity: LeadDeliveryIdentity) {
  return createHash('sha256').update(JSON.stringify([identity.provider, identity.formId, identity.deliveryId])).digest('hex');
}
