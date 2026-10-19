# Universal inbox & messaging (demo candidate, 2026-10-17)

One inbox per **person**, not per workspace. Someone in Quest Roofing, Quest Construction and
Quest Drafting & Design sees a single inbox with every channel message, @mention and task
notification addressed to them, grouped by workspace, with one unread count.

## Status

| Part | State |
|---|---|
| Inbox model (`src/core/inbox.ts`) | Built, 5 tests |
| Demo messaging (3 workspaces, 4 channels, synthetic people/text) | Built, browser-only (`quest.messaging.v1`) |
| Inbox view, channel threads, posting, @mentions, "Make a task" | Built, verified in browser |
| Task notifications as an inbox source | Built (same ids as the sidebar's read set) |
| Live messaging backend | **Not built.** In a live workspace the inbox shows task notifications only |
| QuestBase relations, WhatsApp, email | Reported "not connected"; nothing is read |

## Why there are no duplicate inboxes

- **One identity.** A person is one account (`auth.users.id`) with several memberships. The inbox
  is computed for that id, never per workspace.
- **A view, not a copy.** `universalInbox(person, sources, read)` merges items from sources; nothing
  is written into a second store. Every item points back at its one record (message, task, lead).
- **Dedup by stable id.** Items carry ids like `msg:<id>` or the notification id. The same record
  reached by two routes appears once; a mention beats a plain copy.
- **One read set.** Read state is keyed by item id and shared by the inbox and the sidebar
  notifications panel, so reading something in one place reads it everywhere.
- **Membership decides visibility.** A person only gets items from workspaces and channels they
  belong to (tested: Alex sees nothing from Drafting & Design; the reviewer persona sees nothing).

## Extending it (QuestBase relations and other systems)

Any system adds items through one contract:

```ts
interface InboxSource {
  id: string; label: string;
  status: 'connected' | 'not-connected';
  note: string;
  items(person: string): InboxItem[];   // only items addressed to this person
}
```

A new QuestBase relation (for example underwriting reviews or proposal approvals) implements
`items()` for its own records, with ids namespaced by system (`qb:underwriting:<id>`), and is
added to the source list. The inbox, counts, filters and read state need no changes. Sources that
aren't connected are listed as such and are never simulated.

## Production design (not built; needs approval before any migration)

Messages should **not** live in the per-workspace JSON document (`workspace_state`). Chat grows
without bound and would make every task save heavier. Proposed tables:

- `channels (id, org_id, name, purpose, created_by, archived_at)`
- `channel_members (channel_id, user_id, added_by, added_at)`
- `messages (id, channel_id, org_id, author, body ≤ 2000, mentions uuid[], task_ids text[], kind, created_at)`
- `inbox_reads (user_id, item_id, read_at)`: the one read set, keyed per person, not per org

Rules:

- RLS: read and post only where the caller is in `channel_members` **and** holds an active
  membership in `org_id` (both checks, as in `postMessage`).
- Mentions are resolved server-side against that channel's members; outsiders are dropped.
- `my_inbox(since)` is a security-definer RPC that unions the caller's channel messages and
  mentions across **all** their memberships with their task notifications, returning stable
  item ids. The client keeps the same `universalInbox` merge.
- Realtime is subscribed per channel the person belongs to, not per workspace document.
- Linking a message to tasks stores task ids only; task status is always read from the task.
- Nothing here sends email, SMS or push. Outbound delivery would be a separate, approved step.

## Verified in the browser (demo, Jordan)

- 9 unread across 3 workspaces at first load; opening `#field-operations` cleared its badge, and
  the sidebar Inbox count dropped with it (7).
- Posting `@Alex …` in `#field-operations` mentioned Alex only.
- "Make a task" on Alex's staging message opened the command input with a reviewable draft; Create
  made the tasks through the engine, linked them to the message with live status, and added one
  system line to the channel.
