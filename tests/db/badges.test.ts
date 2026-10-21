import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PRODUCTION_BASELINE, addMember, addOrg, addUser, createDb, read, rpcAs } from './pg.ts';
import type { Db } from './pg.ts';

// The navigation migration allow-lists a real production account, so that account exists first.
const ALLOWLISTED = 'f1cd1413-e5ee-424f-91b0-3fb109247e99';
const AFTER = ['20261019140000_temporary_restricted_navigation.sql', '20261019160000_owner_people_access.sql', '20261020010000_badge_check_in.sql', '20261021232654_badge_identity_v2.sql'];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const PHONE = sha('phone-key-1');
const OTHER_PHONE = sha('phone-key-2');

async function setup() {
  const db = await createDb([...PRODUCTION_BASELINE, '20261018030000_team_staging.sql']);
  await db.pg.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'allowlisted@test.invalid', now())`, [ALLOWLISTED]);
  for (const file of AFTER) await db.pg.exec(read(`supabase/migrations/${file}`));
  const org = await addOrg(db, 'quest-test', 'Quest Test');
  const owner = await addUser(db, 'owner@test.invalid', 'Owner');
  const admin = await addUser(db, 'admin@test.invalid', 'Admin');
  const member = await addUser(db, 'member@test.invalid', 'Crew Member');
  const other = await addUser(db, 'other@test.invalid', 'Other Member');
  await addMember(db, org, owner, 'owner', 'manager');
  await addMember(db, org, admin, 'admin', 'manager');
  await addMember(db, org, member, 'member', 'field');
  await addMember(db, org, other, 'member', 'field');
  await db.pg.query('insert into private.full_navigation_users (user_id) values ($1)', [admin]);
  return { db, org, owner, admin, member, other };
}

/** The badge function's call, as the service role. */
async function scan(db: Db, code: string, device: string) {
  return db.pg.transaction(async tx => {
    await tx.exec("select set_config('request.jwt.claims', '{}', true)");
    await tx.exec('set local role service_role');
    return (await tx.query<{ v: Record<string, unknown> }>('select public.badge_scan($1, $2) v', [sha(code), device])).rows[0]!.v;
  });
}

test('a badge checks its person in and out on their own phone, pending confirmation', async () => {
  const { db, org, admin, member } = await setup();
  assert.equal((await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: member, p_hash: sha('CODE-1') })).error, null);
  const first = await scan(db, 'CODE-1', PHONE);
  assert.deepEqual([first.result, first.kind, first.email], ['ok', 'in', 'member@test.invalid']);
  assert.equal((await scan(db, 'CODE-1', PHONE)).kind, 'out');
  assert.equal((await scan(db, 'CODE-1', PHONE)).kind, 'in');
  const view = (await rpcAs(db, admin, 'org_badges', { p_org: org })).data as { badges: { phone_linked: boolean }[]; check_ins: { id: string; status: string; kind: string }[] };
  assert.equal(view.badges[0]!.phone_linked, true);
  assert.deepEqual(view.check_ins.map(c => c.status), ['pending', 'pending', 'pending']);
  assert.equal((await rpcAs(db, admin, 'decide_check_in', { p_id: view.check_ins[0]!.id, p_confirm: true })).error, null);
  const after = (await rpcAs(db, admin, 'org_badges', { p_org: org })).data as { check_ins: { status: string }[] };
  assert.equal(after.check_ins.filter(c => c.status === 'confirmed').length, 1);
});

test('a badge scanned on another phone signs no one in until an admin approves that phone', async () => {
  const { db, org, admin, member } = await setup();
  await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: member, p_hash: sha('CODE-2') });
  assert.equal((await scan(db, 'CODE-2', PHONE)).result, 'ok');
  const elsewhere = await scan(db, 'CODE-2', OTHER_PHONE);
  assert.equal(elsewhere.result, 'device-pending');
  assert.equal(elsewhere.email, undefined, 'nothing to sign in with');
  assert.equal((await scan(db, 'CODE-2', OTHER_PHONE)).result, 'device-pending', 'asking again adds no duplicate request');
  const pending = ((await rpcAs(db, admin, 'org_badges', { p_org: org })).data as { check_ins: { id: string; kind: string; status: string }[] }).check_ins.filter(c => c.kind === 'device');
  assert.equal(pending.length, 1);
  await rpcAs(db, admin, 'decide_check_in', { p_id: pending[0]!.id, p_confirm: true });
  assert.equal((await scan(db, 'CODE-2', OTHER_PHONE)).result, 'ok', 'the approved phone now works');
  assert.equal((await scan(db, 'CODE-2', PHONE)).result, 'device-pending', 'and the old one no longer does');
});

test('guardrails: owner and admin get no badges, revoked badges fail, check-ins come only from scans', async () => {
  const { db, org, owner, admin, member, other } = await setup();
  assert.match((await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: owner, p_hash: sha('X') })).error?.message ?? '', /Owner and Admin accounts/);
  assert.ok((await rpcAs(db, member, 'badge_issue', { p_org: org, p_user: other, p_hash: sha('Y') })).error, 'members cannot issue badges');
  await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: member, p_hash: sha('CODE-3') });
  // Re-issuing replaces the old badge.
  await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: member, p_hash: sha('CODE-4') });
  assert.equal((await scan(db, 'CODE-3', PHONE)).result, 'unavailable');
  assert.equal((await scan(db, 'CODE-4', PHONE)).result, 'ok');
  await rpcAs(db, admin, 'badge_revoke', { p_org: org, p_user: member });
  assert.equal((await scan(db, 'CODE-4', PHONE)).result, 'unavailable');
  // A member promoted to Admin can no longer use a badge.
  await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: other, p_hash: sha('CODE-5') });
  await db.pg.query(`update public.memberships set role = 'admin' where org_id = $1 and user_id = $2`, [org, other]);
  assert.equal((await scan(db, 'CODE-5', PHONE)).result, 'unavailable');
  // Signed-in people can't write check-ins or call the scan themselves.
  const selfInsert = await db.pg.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: member, role: 'authenticated' })]);
    try { await tx.query(`insert into public.work_check_ins (org_id, user_id, kind) values ($1, $2, 'in')`, [org, member]); return 'inserted'; } catch (error) { return (error as Error).message; }
  });
  assert.match(selfInsert, /permission denied/);
  assert.ok((await rpcAs(db, member, 'badge_scan', { p_code_hash: sha('CODE-4'), p_device_hash: PHONE })).error);
  // Members read their own check-ins only, and can't confirm.
  assert.ok((await rpcAs(db, member, 'org_badges', { p_org: org })).error);
  const anyId = (await db.pg.query<{ id: string }>('select id from public.work_check_ins limit 1')).rows[0]!.id;
  assert.ok((await rpcAs(db, member, 'decide_check_in', { p_id: anyId, p_confirm: true })).error);
});

test('a forgotten check-out: an "in" older than 16 hours starts a fresh day and is flagged', async () => {
  const { db, org, admin, member } = await setup();
  await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: member, p_hash: sha('CODE-6') });
  await scan(db, 'CODE-6', PHONE);
  await db.pg.query(`update public.work_check_ins set at = now() - interval '20 hours' where user_id = $1`, [member]);
  const next = await scan(db, 'CODE-6', PHONE);
  assert.deepEqual([next.kind, next.note], ['in', 'Previous check-in had no check-out']);
});

/** badge-check-in v3's call: the verified signed-in user is passed in by the function. */
async function verify(db: Db, code: string, device: string, user: string) {
  return db.pg.transaction(async tx => {
    await tx.exec("select set_config('request.jwt.claims', '{}', true)");
    await tx.exec('set local role service_role');
    return (await tx.query<{ v: Record<string, unknown> }>('select public.badge_verify($1, $2, $3) v', [sha(code), device, user])).rows[0]!.v;
  });
}

test('badge_verify proves identity on the bound phone and records no attendance', async () => {
  const { db, org, admin, member, other } = await setup();
  await rpcAs(db, admin, 'badge_issue', { p_org: org, p_user: member, p_hash: sha('CODE-V') });
  const count = async () => Number((await db.pg.query<{ n: number }>('select count(*)::int n from public.work_check_ins')).rows[0]!.n);
  assert.equal((await verify(db, 'CODE-V', PHONE, other)).result, 'mismatch', 'another account is refused');
  assert.equal((await db.pg.query<{ device_hash: string | null }>('select device_hash from public.work_badges')).rows[0]!.device_hash, null, 'a mismatch binds nothing');
  const ok = await verify(db, 'CODE-V', PHONE, member);
  assert.deepEqual([ok.result, ok.org_id], ['ok', org]);
  assert.equal(JSON.stringify(ok).includes('member@test.invalid'), false);
  assert.equal((await verify(db, 'CODE-V', PHONE, member)).result, 'ok', 'scanning again toggles nothing');
  assert.equal(await count(), 0, 'no in/out rows: attendance lives in shifts');
  assert.equal((await verify(db, 'CODE-V', OTHER_PHONE, member)).result, 'device-pending');
  assert.equal(await count(), 1, 'only the new-phone approval request');
  for (const role of ['authenticated', 'anon']) {
    await assert.rejects(db.pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query('select public.badge_verify($1, $2, $3)', [sha('CODE-V'), PHONE, member]); }), `${role} cannot call it directly`);
  }
});
