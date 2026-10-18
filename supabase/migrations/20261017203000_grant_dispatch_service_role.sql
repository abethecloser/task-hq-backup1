-- The dispatch Edge Function runs as service_role. This project does not grant API roles
-- table privileges by default, so grant exactly what dispatch uses (least privilege).
-- Clients (anon/authenticated) are unchanged; RLS policies are unchanged.
grant select on public.organizations, public.profiles, public.memberships to service_role;
grant select, insert, update on public.workspace_state to service_role;
grant insert on public.audit_log to service_role;
