// No production fallback, project discovery, credential lookup, or .env loading.
export function testTarget(env) {
  const value = env.TASK_HQ_TEST_DATABASE_URL;
  if (!value) throw new Error('Set TASK_HQ_TEST_DATABASE_URL for the explicitly authorized non-production database.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid test database URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL test URL required.');
  const host = url.hostname;
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  const ref = env.TASK_HQ_TEST_PROJECT_REF;
  const target = `${host}/${user}/${database}/${ref ?? ''}`;
  if (target.includes('xthyyxnfjaxmtrqrhyxc')) throw new Error('Production Task-HQ database is forbidden.');
  if (target.includes('tludofhanachvjbzffid')) throw new Error('Unrelated inactive project is forbidden.');
  const local = ['localhost','127.0.0.1','[::1]'].includes(host);
  if (local) {
    if (!/^task_hq_intake_test(?:_[a-z0-9]+)?$/.test(database)) throw new Error('Local target must be a disposable task_hq_intake_test database.');
  } else {
    if (!ref || !/^[a-z]{20}$/.test(ref)) throw new Error('Explicitly authorized TASK_HQ_TEST_PROJECT_REF required.');
    const direct = host === `db.${ref}.supabase.co`;
    const pooler = host.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`;
    if (!direct && !pooler) throw new Error('Test target does not match the authorized Supabase project reference.');
    if (url.searchParams.get('sslmode') !== 'require') throw new Error('Remote test connection requires sslmode=require.');
  }
  return { label: local ? database : ref, env: {
    ...env, PGHOST: host.replace(/^\[|\]$/g,''), PGPORT: url.port || '5432', PGDATABASE: database,
    PGUSER: user, PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '10',
    PGSSLMODE: local ? 'disable' : 'require',
  } };
}
