import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTarget } from './target.mjs';
test('no database or implicit production configuration is accepted', () => {
  assert.throws(()=>testTarget({}),/explicitly authorized/);
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:'postgresql://postgres:synthetic@db.xthyyxnfjaxmtrqrhyxc.supabase.co/postgres?sslmode=require', TASK_HQ_TEST_PROJECT_REF:'xthyyxnfjaxmtrqrhyxc'}),/forbidden/);
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:'postgresql://postgres.xthyyxnfjaxmtrqrhyxc:synthetic@aws-0-us-west-1.pooler.supabase.com/postgres?sslmode=require', TASK_HQ_TEST_PROJECT_REF:'xthyyxnfjaxmtrqrhyxc'}),/forbidden/);
});
test('local use requires a separately named disposable database', () => {
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:'postgresql://postgres@localhost/postgres'}),/disposable/);
  const target=testTarget({TASK_HQ_TEST_DATABASE_URL:'postgresql://postgres:synthetic@localhost:55432/task_hq_intake_test_run1'});
  assert.equal(target.env.PGDATABASE,'task_hq_intake_test_run1');
  assert.equal(target.env.PGPORT,'55432');
  assert.equal(target.env.PGPASSWORD,'synthetic');
});
test('remote database must match the explicitly authorized non-production reference', () => {
  const ref='abcdefghijklmnopqrst';
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:`postgresql://postgres@db.${ref}.supabase.co/postgres?sslmode=require`}),/PROJECT_REF/);
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:'postgresql://postgres@db.uvwxyzabcdefghijklmn.supabase.co/postgres?sslmode=require',TASK_HQ_TEST_PROJECT_REF:ref}),/does not match/);
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:`postgresql://postgres@db.${ref}.supabase.co/postgres`,TASK_HQ_TEST_PROJECT_REF:ref}),/sslmode/);
  assert.equal(testTarget({TASK_HQ_TEST_DATABASE_URL:`postgresql://postgres@db.${ref}.supabase.co/postgres?sslmode=require`,TASK_HQ_TEST_PROJECT_REF:ref}).label,ref);
});
test('malformed URL never appears in the error output', () => {
  const secret='synthetic-secret';
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:`bad ${secret}`}), error=>!error.message.includes(secret));
});
test('the explicitly excluded unrelated inactive project is also forbidden', () => {
  const ref='tludofhanachvjbzffid';
  assert.throws(()=>testTarget({TASK_HQ_TEST_DATABASE_URL:`postgresql://postgres@db.${ref}.supabase.co/postgres?sslmode=require`,TASK_HQ_TEST_PROJECT_REF:ref}),/Unrelated inactive project/);
});
