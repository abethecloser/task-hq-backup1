-- Open the approved core sections (2026-10-21, Production Sprint 01 Phase 1).
-- Lifts the temporary "Under construction" restriction for every member on:
--   Team / People & access (people), Projects (company-work), Reports (reports),
--   Policy & data (settings), Inbox / Mentions (inbox), Attention (needs-attention),
--   Activity (activity), Search (search: @mention and #tag links open it).
-- Still restricted: tools, leads, executive, relationships, feedback, agents.
-- Unchanged: memberships, roles, Manage gating (canManage), and every function's own
-- owner/admin checks, which run right after require_section('people').
-- Rollback (exact):
--   insert into private.restricted_sections (section) values
--     ('people'), ('company-work'), ('reports'), ('settings'), ('inbox'), ('needs-attention'), ('activity'), ('search')
--   on conflict do nothing;
delete from private.restricted_sections
where section in ('people', 'company-work', 'reports', 'settings', 'inbox', 'needs-attention', 'activity', 'search');
