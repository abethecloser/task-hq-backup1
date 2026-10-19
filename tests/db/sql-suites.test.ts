// The repository's SQL test suites (supabase/tests/*.sql) executed for real against
// Task-HQ's migrations. PGlite + stubbed Supabase auth; worst-case default grants, so
// only the migrations' own REVOKEs and RLS stand between tenants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_BASELINE, addUser, createDb, runSqlSuite } from './pg.ts';

test('tenant isolation and authority (rls_isolation.sql) on the production baseline', async () => {
  const db = await createDb(PRODUCTION_BASELINE, { broadGrants: true });
  // The suite exercises the platform-admin boundary with an existing platform admin.
  const admin = await addUser(db, 'platform-admin@example.test');
  await db.pg.query(`insert into private.platform_admins (user_id, granted_by) values ($1, 'test')`, [admin]);
  const result = await runSqlSuite(db, 'rls_isolation.sql');
  await db.close();
  assert.equal(result.fail, 0, result.notes);
  assert.ok(result.pass >= 36, `expected the full suite incl. platform-admin checks, got ${result.pass}`);
});

test('team staging and People & Roles functions (team_staging.sql) — applied in production 2026-10-17', async () => {
  const db = await createDb([...PRODUCTION_BASELINE, '20261018030000_team_staging.sql'], { broadGrants: true });
  const result = await runSqlSuite(db, 'team_staging.sql');
  await db.close();
  assert.equal(result.fail, 0, result.notes);
  assert.equal(result.pass, 54);
});

test('platform owner-invite gap: fails on the current baseline, fixed by the candidate migration', async () => {
  const seedAdmin = async (db: Awaited<ReturnType<typeof createDb>>) => {
    const id = await addUser(db, 'platform-admin@example.test');
    await db.pg.query(`insert into private.platform_admins (user_id, granted_by) values ($1, 'test')`, [id]);
  };
  const before = await createDb(PRODUCTION_BASELINE, { broadGrants: true });
  await seedAdmin(before);
  const unfixed = await runSqlSuite(before, 'platform_owner_invite.sql');
  await before.close();
  assert.ok(unfixed.fail > 0, 'the test must detect the gap on the unhardened baseline');
  assert.match(unfixed.notes, /invited 2nd owner into owned org/);

  const after = await createDb([...PRODUCTION_BASELINE, '20261018020000_harden_platform_owner_invite.sql'], { broadGrants: true });
  await seedAdmin(after);
  const fixed = await runSqlSuite(after, 'platform_owner_invite.sql');
  await after.close();
  assert.equal(fixed.fail, 0, fixed.notes);
});
