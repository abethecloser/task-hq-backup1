import type { IntakeEnvelope } from './intake.ts';
export interface IntakeValidationError { field: string; code: 'required' | 'invalid' | 'too_long'; message: string }
export type IntakeValidation = { ok: true; envelope: IntakeEnvelope } | { ok: false; errors: IntakeValidationError[] };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
/** Shared boundary validation; SQL remains authoritative. No provider, tenant or
 * owner inference. Normalization never invents source/event identity or arrival. */
export function validateIntakeEnvelope(input: unknown, now = Date.now()): IntakeValidation {
  const errors: IntakeValidationError[] = [];
  const bad = (field: string, message: string) => errors.push({ field, code: 'invalid', message });
  if (!object(input)) return { ok: false, errors: [{ field: 'envelope', code: 'invalid', message: 'Supply an inquiry object.' }] };
  try { if (new TextEncoder().encode(JSON.stringify(input)).length > 16384) bad('envelope','Maximum size is 16 KiB.'); }
  catch { bad('envelope','Supply a JSON-serializable inquiry.'); }
  for (const k of Object.keys(input)) if (!['version','sourceId','externalId','receivedAt','contact','inquiry'].includes(k)) bad(k,'Unknown field.');
  if (input.version !== 1) bad('version','Only intake version 1 is supported.');
  const text = (x: unknown, field: string, max: number, min = 0) => {
    if (x === undefined && min === 0) return '';
    if (typeof x !== 'string') { bad(field,'Supply text.'); return ''; }
    const s = x.replace(/^ +| +$/g,'');
    if (s.length < min || s.length > max) bad(field,`Length must be ${min}–${max}.`);
    return s;
  };
  const sourceId = text(input.sourceId,'sourceId',80,3);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(sourceId) || input.sourceId !== sourceId) bad('sourceId','Supply the approved source identifier.');
  const externalId = text(input.externalId,'externalId',200,1);
  if (/[\u0000-\u001f\u007f]/.test(externalId)) bad('externalId','Event ID cannot contain control characters.');
  const receivedAt = typeof input.receivedAt === 'string' ? input.receivedAt : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(receivedAt);
  const stamp = Date.parse(receivedAt);
  if (!match || !Number.isFinite(stamp) || !Number.isFinite(now) || stamp > now + 300000
    || Number(match[2]) < 1 || Number(match[2]) > 12 || Number(match[3]) < 1
    || Number(match[3]) > new Date(Date.UTC(Number(match[1]),Number(match[2]),0)).getUTCDate()
    || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) bad('receivedAt','Supply a valid arrival timestamp with timezone, at most five minutes in the future.');
  const contact = object(input.contact) ? input.contact : {};
  const inquiry = object(input.inquiry) ? input.inquiry : {};
  if (!object(input.contact)) bad('contact','Supply contact details.');
  if (!object(input.inquiry)) bad('inquiry','Supply inquiry details.');
  for (const k of Object.keys(contact)) if (!['name','email','phone'].includes(k)) bad(`contact.${k}`,'Unknown field.');
  for (const k of Object.keys(inquiry)) if (!['need','address'].includes(k)) bad(`inquiry.${k}`,'Unknown field.');
  const name = text(contact.name,'contact.name',120,1), email = text(contact.email,'contact.email',254).toLowerCase();
  const rawPhone = text(contact.phone,'contact.phone',16384), phone = rawPhone.replace(/[\s().-]/g,'');
  const need = text(inquiry.need,'inquiry.need',2000,3), address = text(inquiry.address,'inquiry.address',500);
  if (/[\u0000-\u001f\u007f]/.test(name)) bad('contact.name','Name cannot contain control characters.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('contact.email','Supply a valid email.');
  if (phone && !/^\+?\d{7,15}$/.test(phone)) bad('contact.phone','Supply 7–15 digits, with an optional leading +.');
  if (!email && !phone) bad('contact','Supply at least one valid contact method.');
  if (errors.length) return {ok:false,errors};
  return {ok:true,envelope:{version:1,sourceId,externalId,receivedAt:new Date(stamp).toISOString(),contact:{name,...(email?{email}:{}),...(phone?{phone}:{})},inquiry:{need,...(address?{address}:{})}}};
}
