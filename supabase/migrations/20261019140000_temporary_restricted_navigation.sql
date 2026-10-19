-- Temporary restricted navigation (2026-10-19).
-- While sections are being rebuilt, only allowlisted accounts (by immutable auth user id) may
-- open them; everyone else keeps Home and Tasks. Additive and reversible per section:
--   reopen one section for everyone:  delete from private.restricted_sections where section = 'people';
--   give someone full navigation:     insert into private.full_navigation_users (user_id, note) values ('<uuid>', '…');
-- Memberships, roles and existing permission checks are unchanged; the People & Roles write
-- functions gain one guard line in front of their existing checks. Activation, invitation
-- acceptance, access requests, my_context and platform functions are not gated.

create table private.full_navigation_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '',
  granted_at timestamptz not null default now()
);

create table private.restricted_sections (
  section text primary key check (section ~ '^[a-z][a-z-]*$'),
  restricted_at timestamptz not null default now()
);

insert into private.full_navigation_users (user_id, note)
values ('f1cd1413-e5ee-424f-91b0-3fb109247e99', 'team@enternovum.com: full navigation while sections are rebuilt');

-- App view ids (src/app/App.tsx). Home and All Tasks are never listed here.
insert into private.restricted_sections (section) values
  ('inbox'), ('search'), ('tools'), ('needs-attention'), ('leads'), ('executive'), ('company-work'),
  ('relationships'), ('people'), ('reports'), ('activity'), ('feedback'), ('settings'), ('agents');

create function private.section_allowed(p_section text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.restricted_sections where section = p_section)
      or exists (select 1 from private.full_navigation_users where user_id = (select auth.uid()));
$$;

create function private.require_section(p_section text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.section_allowed(p_section) then
    raise exception 'This area is under construction.';
  end if;
end;
$$;

-- What the signed-in account may open. Never throws; anonymous callers get full = false.
create function public.my_navigation() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'full', exists (select 1 from private.full_navigation_users where user_id = (select auth.uid())),
    'restricted', coalesce((select jsonb_agg(section order by section) from private.restricted_sections), '[]'::jsonb));
$$;

revoke all on function private.section_allowed(text), private.require_section(text) from public, anon, authenticated;
revoke all on function public.my_navigation() from public, anon;
grant execute on function public.my_navigation() to authenticated;

-- Add the guard to the live People & Roles write functions (built from their current
-- definitions, so nothing else in them changes). Idempotent.
do $$
declare f record; v_def text; v_new text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname in (
      'create_invitation', 'revoke_invitation', 'decide_access_request', 'set_member_role', 'remove_member',
      'save_staged_contact', 'remove_staged_contact', 'confirm_staged_affiliation', 'invite_staged_contact',
      'invite_staged_contacts', 'save_staged_assignment', 'remove_staged_assignment', 'mark_staged_assignment_converted')
  loop
    v_def := pg_get_functiondef(f.oid);
    continue when position('private.require_section(' in v_def) > 0;
    v_new := regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform private.require_section(''people'');\n');
    if v_new = v_def then raise exception 'No function body start found in %', f.proname; end if;
    execute v_new;
  end loop;
end
$$;
