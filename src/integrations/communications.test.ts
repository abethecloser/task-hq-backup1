import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommunicationInquiry } from './communications.ts';
import type { CommunicationChannel } from './communications.ts';

const config = { sourceId: 'synthetic.website', now: Date.parse('2026-10-17T18:00:00Z') };
const details = { receivedAt: '2026-10-17T17:00:00Z', contact: { name: ' Synthetic Person ', email: ' SYNTHETIC@EXAMPLE.TEST ', phone: '+1 (602) 555-0100' }, inquiry: { need: ' Synthetic quote request ', address: ' Fixture address ' } };
test('all four supplied inquiry channels project into the same intake contract', () => {
  for (const [channel, field] of Object.entries({ website_quote: 'submissionId', business_email: 'messageId', receptionist_call: 'callId', manual: 'entryId' })) {
    const result = normalizeCommunicationInquiry(channel as CommunicationChannel, { ...details, [field]: 'original-event-1' }, config);
    assert.deepEqual(result, { ok: true, envelope: { version: 1, sourceId: config.sourceId, externalId: 'original-event-1', receivedAt: '2026-10-17T17:00:00.000Z',
      contact: { name: 'Synthetic Person', email: 'synthetic@example.test', phone: '+16025550100' }, inquiry: { need: 'Synthetic quote request', address: 'Fixture address' } } });
  }
});
test('provider identities are required and never generated or borrowed across channels', () => {
  for (const payload of [{ ...details }, { ...details, messageId: 'different-channel-id' }, { ...details, submissionId: ' ' }, { ...details, submissionId: 'id\nheader' }]) {
    const result = normalizeCommunicationInquiry('website_quote', payload, config);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some(error => error.field === 'submissionId'));
  }
});
test('projection strips routing overrides, secrets, transcripts and attachments without mutating input', () => {
  const input = { ...structuredClone(details), submissionId: 'event-1', sourceId: 'attacker.source', orgId: 'foreign', ownerId: 'foreign', transcript: 'sensitive', attachments: ['sensitive'], headers: { Authorization: 'secret' } };
  const snapshot = structuredClone(input);
  const result = normalizeCommunicationInquiry('website_quote', input, config);
  assert.equal(result.ok, true);
  assert.deepEqual(input, snapshot);
  if (result.ok) {
    assert.equal(result.envelope.sourceId, config.sourceId);
    for (const text of ['foreign', 'sensitive', 'secret', 'attacker']) assert.equal(JSON.stringify(result).includes(text), false);
  }
});
test('retry produces identical envelopes including delayed arrivals and original email message IDs', () => {
  const input = { ...details, receivedAt: '2025-10-17T17:00:00Z', messageId: '<original@example.test>' };
  assert.deepEqual(normalizeCommunicationInquiry('business_email', input, config), normalizeCommunicationInquiry('business_email', input, { ...config, now: config.now + 5000 }));
});
test('invalid contact, needs, lengths, timezone and future timestamps fail with safe field errors', () => {
  for (const patch of [
    { contact: { name: 'Synthetic', email: 'invalid' } }, { contact: { name: 'Synthetic', phone: 'abc1234567' } },
    { contact: { name: 'Synthetic' } }, { contact: { name: '', email: 'synthetic@example.test' } },
    { inquiry: { need: 'no' } }, { inquiry: { need: 'x'.repeat(2001) } },
    { receivedAt: '2026-10-17T17:00:00' }, { receivedAt: '2026-10-17T18:06:00Z' }, { receivedAt: 'not-a-date' },
  ]) {
    const result = normalizeCommunicationInquiry('website_quote', { ...details, submissionId: 'event-1', ...patch }, config);
    assert.equal(result.ok, false, JSON.stringify(patch));
    if (!result.ok) assert.ok(result.errors.length > 0);
  }
});
test('invalid supplied secondary contact is rejected even with a valid primary contact', () => {
  assert.equal(normalizeCommunicationInquiry('manual', { ...details, entryId: 'entry-1', contact: { name: 'Synthetic', email: 'synthetic@example.test', phone: 'invalid' } }, config).ok, false);
});
test('canonical validation rejects impossible dates, excess precision, source IDs and name control characters', () => {
  for (const receivedAt of ['2026-02-30T12:00:00Z', '2026-10-17T17:00:00.1234Z', '2026-10-17T24:00:00Z']) {
    const result = normalizeCommunicationInquiry('website_quote', { ...details, submissionId: 'event-1', receivedAt }, config);
    assert.equal(result.ok, false, receivedAt);
    if (!result.ok) assert.ok(result.errors.some(error => error.field === 'receivedAt'));
  }
  for (const sourceId of ['Synthetic.website', 'synthetic:website']) {
    assert.equal(normalizeCommunicationInquiry('website_quote', { ...details, submissionId: 'event-1' }, { ...config, sourceId }).ok, false);
  }
  const result = normalizeCommunicationInquiry('website_quote', { ...details, submissionId: 'event-1', contact: { ...details.contact, name: 'Synthetic\nName' } }, config);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some(error => error.field === 'contact.name'));
});
test('canonical validation preserves actual leap dates and normalizes timezone timestamps', () => {
  const result = normalizeCommunicationInquiry('website_quote', { ...details, submissionId: 'event-1', receivedAt: '2024-02-29T12:00:00-07:00' }, config);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.envelope.receivedAt, '2024-02-29T19:00:00.000Z');
});
