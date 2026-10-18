import type { IntakeEnvelope } from '../adapter/intake.ts';
import { validateIntakeEnvelope } from '../adapter/intake-validation.ts';

export type CommunicationChannel = 'website_quote' | 'business_email' | 'receptionist_call' | 'manual';
export interface CommunicationError { field: string; code: 'required' | 'invalid' | 'too_long'; message: string }
export type CommunicationResult = { ok: true; envelope: IntakeEnvelope } | { ok: false; errors: CommunicationError[] };
const identityFields: Record<CommunicationChannel, string> = {
  website_quote: 'submissionId', business_email: 'messageId', receptionist_call: 'callId', manual: 'entryId',
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Pure, allowlisted projection of explicitly supplied inquiry details. This is
 * not a webhook/authentication implementation. The caller verifies the provider
 * and supplies a server-controlled approved sourceId. Database authorization is
 * still mandatory. No credentials, audio, transcripts or attachments survive.
 * Persist the returned envelope unchanged before attempting delivery/retries.
 */
export function normalizeCommunicationInquiry(channel: CommunicationChannel, payload: unknown,
  config: { sourceId: string; now?: number }): CommunicationResult {
  const errors: CommunicationError[] = [];
  const error = (field: string, code: CommunicationError['code'], message: string) => errors.push({ field, code, message });
  const text = (value: unknown, field: string, max: number, required = false): string | undefined => {
    if (value === undefined || value === null || value === '') {
      if (required) error(field, 'required', 'A value is required.');
      return undefined;
    }
    if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      error(field, 'invalid', 'Supply plain text.'); return undefined;
    }
    const clean = value.trim();
    if (!clean && required) error(field, 'required', 'A value is required.');
    if (clean.length > max) error(field, 'too_long', `Maximum length is ${max}.`);
    return clean || undefined;
  };
  const input = record(payload), contact = record(input.contact), inquiry = record(input.inquiry);
  const identityField = identityFields[channel];
  if (!identityField) return { ok: false, errors: [{ field: 'channel', code: 'invalid', message: 'Unsupported inquiry channel.' }] };
  const sourceId = text(config.sourceId, 'sourceId', 80, true);
  if (sourceId && !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(sourceId)) error('sourceId', 'invalid', 'Supply a configured lowercase source identifier.');
  const externalId = text(input[identityField], identityField, 200, true);
  if (externalId && /\s/.test(externalId)) error(identityField, 'invalid', 'Supply the original stable event identifier without whitespace.');
  const receivedAt = text(input.receivedAt, 'receivedAt', 64, true);
  const now = config.now ?? Date.now();
  if (receivedAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(receivedAt)
    || !Number.isFinite(Date.parse(receivedAt)) || !Number.isFinite(now) || Date.parse(receivedAt) > now + 300_000)) {
    error('receivedAt', 'invalid', 'Supply an arrival timestamp with timezone, at most five minutes in the future.');
  }
  const name = text(contact.name, 'contact.name', 120, true);
  const rawEmail = text(contact.email, 'contact.email', 254);
  const email = rawEmail?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error('contact.email', 'invalid', 'Supply a valid email address.');
  const rawPhone = text(contact.phone, 'contact.phone', 80);
  const phone = rawPhone?.replace(/[\s().-]/g, '');
  if (phone && !/^\+?\d{7,15}$/.test(phone)) error('contact.phone', 'invalid', 'Supply a phone number with 7 to 15 digits.');
  if (!email && !phone) error('contact', 'required', 'Supply at least one valid email address or phone number.');
  const need = text(inquiry.need, 'inquiry.need', 2000, true);
  if (need && need.length < 3) error('inquiry.need', 'invalid', 'Describe the inquiry using at least three characters.');
  const address = text(inquiry.address, 'inquiry.address', 500);
  if (errors.length) return { ok: false, errors };
  return validateIntakeEnvelope({ version: 1, sourceId: sourceId!, externalId: externalId!, receivedAt: receivedAt!,
    contact: { name: name!, ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
    inquiry: { need: need!, ...(address ? { address } : {}) } }, now);
}
