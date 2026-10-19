// Real-SQL test harness: Task-HQ's own migrations on an in-memory Postgres (PGlite),
// with the parts of Supabase they rely on stubbed: the anon/authenticated/service_role
// roles, auth.users and auth.uid() (from request.jwt.claims), the realtime publication
// and the RLS event-trigger function. This is NOT Supabase: no PostgREST, no GoTrue,
// no Realtime. Results are reported as "PGlite + stubbed Supabase auth".
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ROOT = new URL('../../', import.meta.url);
export const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

/** The four migrations production has (verified 2026-10-17), in order. */
export const PRODUCTION_BASELINE = [
  '20261017180000_tenancy_core.sql',
  '20261017200000_org_admin_overview.sql',
  '20261017201000_harden_rls_auto_enable.sql',
  '20261017203000_grant_dispatch_service_role.sql',
];

export interface Db { pg: PGlite; close(): Promise<void> }

/**
 * @param migrations   applied after the stubs, in order (file names in supabase/migrations)
 * @param broadGrants  true = worst case (API roles get every privilege by default, so only
 *                     explicit REVOKEs protect tables); false = this project's real setting,
 *                     where API roles get nothing unless a migration grants it.
 */
export async function createDb(migrations: string[], { broadGrants = false } = {}): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb, last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end $$;
    create publication supabase_realtime;
    ${broadGrants ? `alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;` : ''}`);
  for (const file of migrations) {
    try { await pg.exec(read(`supabase/migrations/${file}`)); }
    catch (error) { throw new Error(`migration ${file} failed: ${(error as Error).message}`); }
  }
  return { pg, close: () => pg.close() };
}

/** Runs one of supabase/tests/*.sql (which end by raising "RESULT pass=… fail=… | …"). */
export async function runSqlSuite(db: Db, file: string): Promise<{ pass: number; fail: number; notes: string }> {
  try { await db.pg.exec(read(`supabase/tests/${file}`)); }
  catch (error) {
    const match = /RESULT pass=(\d+) fail=(\d+) \| (.*)/.exec((error as Error).message);
    if (match) return { pass: Number(match[1]), fail: Number(match[2]), notes: match[3]! };
    throw error;
  }
  throw new Error(`${file} finished without a RESULT line`);
}

let seq = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export async function addUser(db: Db, email: string, name = '') {
  const id = uuid();
  await db.pg.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3)`, [id, email, JSON.stringify(name ? { full_name: name } : {})]);
  return id;
}
export async function addOrg(db: Db, slug: string, name: string) {
  const id = uuid();
  await db.pg.query(`insert into public.organizations (id, slug, name, preset) values ($1, $2, $3, 'roofing')`, [id, slug, name]);
  return id;
}
export async function addMember(db: Db, org: string, user: string, role: string, workRole: string) {
  await db.pg.query(`insert into public.memberships (org_id, user_id, role, work_role) values ($1, $2, $3, $4)`, [org, user, role, workRole]);
}

/** Calls public.<fn>(named args) as a signed-in user, the way a browser RPC would. */
export async function rpcAs(db: Db, user: string, fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  const names = Object.keys(args);
  try {
    const result = await db.pg.transaction(async tx => {
      await tx.exec('set local role authenticated');
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
      return tx.query<{ v: unknown }>(`select public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) as v`, names.map(name => param(args[name])));
    });
    return { data: result.rows[0]?.v ?? null, error: null };
  } catch (error) { return { data: null, error: { code: (error as { code?: string }).code, message: (error as Error).message } }; }
}

const param = (value: unknown) => (Array.isArray(value) && value.every(item => typeof item === 'string') && !value.some(item => item.startsWith('['))
  ? `{${value.join(',')}}`
  : value !== null && typeof value === 'object' ? JSON.stringify(value) : value);

/**
 * The service-role database client the dispatch function expects, reduced to exactly the
 * query shapes handler.ts uses. Every statement runs as service_role (so missing grants
 * fail here as they would in production). Anything else throws, so a test can't pass by
 * accident through an unimplemented path.
 */
export function serviceClient(db: Db) {
  const TABLES = new Set(['memberships', 'organizations', 'profiles', 'workspace_state', 'audit_log']);
  const asService = async <T>(sql: string, params: unknown[]) => db.pg.transaction(async tx => { await tx.exec('set local role service_role'); return tx.query<T>(sql, params); });
  const fail = (error: unknown) => ({ data: null, error: { code: (error as { code?: string }).code, message: (error as Error).message } });
  return {
    from(table: string) {
      if (!TABLES.has(table)) throw new Error(`serviceClient: table ${table} is not used by the handler`);
      const where: string[] = []; const params: unknown[] = []; let columns = '*';
      const select = async () => {
        try { return { data: (await asService<Record<string, unknown>>(`select ${columns} from public.${table}${where.length ? ` where ${where.join(' and ')}` : ''}`, params)).rows, error: null }; }
        catch (error) { return fail(error); }
      };
      const query = {
        select(cols: string) { if (!/^[a-z_, ]+$/.test(cols)) throw new Error(`serviceClient: unsupported select ${cols}`); columns = cols; return query; },
        eq(column: string, value: unknown) { params.push(value); where.push(`${column} = $${params.length}`); return query; },
        in(column: string, values: unknown[]) { params.push(`{${values.join(',')}}`); where.push(`${column} = any($${params.length})`); return query; },
        async maybeSingle() { const r = await select(); if (r.error) return r; return r.data!.length > 1 ? fail(new Error('more than one row')) : { data: r.data![0] ?? null, error: null }; },
        async single() { const r = await select(); if (r.error) return r; return r.data!.length !== 1 ? fail(new Error(`expected one row, got ${r.data!.length}`)) : { data: r.data![0], error: null }; },
        then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) { return select().then(resolve, reject); },
        async insert(row: Record<string, unknown>) {
          const keys = Object.keys(row);
          try { await asService(`insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map(key => param(row[key]))); return { data: null, error: null }; }
          catch (error) { return fail(error); }
        },
      };
      return query;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      try { const r = await asService<{ v: unknown }>(`select public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) as v`, names.map(name => param(args[name]))); return { data: r.rows[0]?.v ?? null, error: null }; }
      catch (error) { return fail(error); }
    },
    auth: { admin: { async getUserById(id: string) { const r = await db.pg.query<{ email: string }>('select email from auth.users where id = $1', [id]); return { data: { user: r.rows[0] ? { id, email: r.rows[0].email } : null }, error: null }; } } },
  };
}
