# Client workspace — status and server gap

## What exists (demo)

- `src/core/client-portal.ts`: the projection a client may see for one project, plus New Quest.
  - **Shared work:** tasks in the client's project that the team tagged `client`. Tasks tagged `client-input` as well appear under *Needs your input*. Untagged work stays internal.
  - **What reaches the client:** title, status, due date and completion time for shared tasks; progress milestones derived from the event log's *action type* (never its text, which can hold internal notes); and messages and files in the project's client channel.
  - **What never reaches the client:** descriptions, comments, blocker notes, other projects, other channels and people's task authority. `client-portal.test.ts` checks this.
  - **New Quest:** posts a message to the project's client channel, with `quest` (the kind) and optional `attachments`. It reaches the team's universal inbox as an urgent item (`channelSource`). The team can make a task from it with the thread's existing *Make a task*. New Quest never creates a task itself.
- `src/app/ClientWorkspace.tsx`: the client UI at `#/client`, demo only. To open it, use the account menu → *Preview client workspace*. It renders no team navigation, search, assistant or task tools.
- **Client identity:** the client is a messaging identity only. It is not a Task HQ team member, so it has no task authority. Being a watcher was deliberately not used for sharing, because watchers can act on tasks (`permissions.ts`, `engine.ts`).

## Why live Task HQ can't offer it yet

1. **Whole-workspace reads.**
   - `public.workspace_state` is one JSON row per organization.
   - The `workspace_state_read` policy allows any member to `select` it.
   - Making a client a member would expose every task, comment and person.
   - There is no row or project-level boundary to scope.
2. **No client role or project membership.**
   - `org_role` covers `owner | admin | supervisor | member | reviewer`. Reviewer reads everything.
   - Nothing models "this person may see project P".
3. **No live messaging.**
   - Channels and messages live only in the demo browser store (`adapter/messaging.ts`).
   - In a live workspace the inbox shows task notifications only.
4. **No live file store for messages.**
   - Attachments use device IndexedDB (`adapter/media.ts`).
   - The only private bucket is `quest-shift-media`.

Hiding UI does not fix any of these, so the live app ignores `#/client`.

## Proposed server work (needs approval: schema change)

1. **`client_grants (org_id, user_id, project_id, created_by, revoked_at)`**
   - Inserts only through a security-definer function callable by owners and admins.
   - Clients are *not* rows in `memberships`, so `workspace_state_read` stays closed to them.
2. **Edge function `client-workspace`**
   - Loads the org's state with the service role.
   - Checks an active grant for `auth.uid()` and the requested project.
   - Returns `clientWorkspace(...)`, the same code as this module, synced like the dispatch core.
   - Refuses every other project.
3. **`client_messages` table**
   - Columns: `org_id, project_id, author, kind, quest, body, created_at`.
   - RLS: a client reads and inserts rows only for granted projects; members read their org.
   - The internal inbox reads it as one more `InboxSource`.
4. **Private storage bucket `client-files`**
   - Path: `org/project/…`.
   - Insert and select policies use the same grant check.
5. **Tests in `supabase/tests`**
   - The client reads only the granted project.
   - A revoked grant reads nothing.
   - The client cannot read `workspace_state`, other projects' messages or other buckets.
