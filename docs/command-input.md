# Command input

**Where it appears**
- Home (top of My Work, beside "Full form").
- All Tasks (above the lenses).
- Create Task ("Describe it in one line", which fills the form).
- Not shown to reviewers.

**Syntax** (local and deterministic, no AI calls; parser in `src/core/command.ts`)

| You type | It means |
|---|---|
| `@Maya`, `@Sam Lee` | A person. Members first; staged people are marked "not invited". **A mention only adds a watcher.** |
| `assign … to Sam`, `ask Sam to …`, `owner Sam`, `for @Sam` | A **proposed** owner. Applied only when you press **Confirm**, or pick someone in the Owner field. |
| `review by Jordan`, `approval from Jordan` | A **proposed** reviewer (approver), confirmed the same way. |
| `#permits` | A tag (known tags are suggested; new ones are flagged). |
| `/inspection` | A task type from the organization's configured types. Words like "meeting" or "permit" count **only if configured** (Policy & data → Task types & tags). |
| `!high`, `!!`, "high priority", "urgent" | High priority. Low reads as Normal; Task-HQ has two levels. |
| today, tomorrow, friday, next monday, in 3 days, 10/24, Oct 24, 2026-10-24, at 9am, 9:30, 14:00, noon | The due date and time. How each was read is shown in the review. |
| `then …`, a newline, or a numbered list | Planning mode: several drafts, where each "then" starts after the previous one. |

**Keyboard:** ↑/↓ moves through suggestions, Enter/Tab picks one, Esc closes them, Enter (with no suggestions open) reviews, ⇧Enter adds a new line.

**Review → Create.**
- Every draft is editable: title, owner, reviewer, due date and time, priority, type, tags, watchers and "starts after".
- The whole batch is dry-run through the engine as you, so anything that would be refused is shown before you can create.
- Create sends each task through the normal permission-checked dispatch, in order, with dependencies wired. "Undo all" reverses them.
- Nothing is sent: no email, calendar invitation or external message. The only in-app notification is the one assignment always creates.

**Staged people:** shown as "not invited". They can't own or approve work. Owners and admins get **Plan for them instead**, which saves the draft as planned work in People & Roles.

**Live workspace today:** the deployed server (dispatch v3) predates types, tags and times. The composer says so and creates the task without them until the next server deploy. Title, owner, reviewer, date, priority, watchers and dependencies all work now.

**Not built yet**
- An AI planning layer, which needs a provider choice and approval. The parser is the baseline; AI would only refine ambiguous plans.
- The command input in the Chrome Companion popup.
