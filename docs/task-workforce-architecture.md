# Task HQ specialist participants — architecture (TASK-WORKFORCE-001)

**Synopsis.** A declared registry of seven functional participants and an Overseer that coordinates them,
wired into the existing Working setup. Everything runs as deterministic checks over the task's own fields.
**No model, runtime, NAN or QBIO integration exists or is implied.** Task HQ keeps the task record; participants
only return findings a person reviews.

## Boundaries
| Owner | Responsibility |
|---|---|
| Task HQ | Task lifecycle, assignments, execution records, permissions. Unchanged. |
| Participants (`src/core/participants.ts`) | Functional readings and recommendations. Never write to a task. |
| Overseer | Chooses relevant specialists, reconciles findings, surfaces conflicts, gaps and decisions. |
| QBIO (QuestBase) | Contextual human-facing interaction. Its contract (`qb/src/qbio/contract.ts`) is project intelligence (source → observation → hypothesis → decision) and states task status and assignment belong to Task HQ. Read for alignment only. |
| SYNAPSE (QuestBase) | Closed capability registry allowing four effects: prepare, review, record, request-decision. Adding capabilities there is a Director decision. |
| NAN | Shared intelligence foundation. QuestBase records no NAN adapter. Not connected here. |

## Participant contract
`id`, `name`, `responsibility`, `areas` (work kinds), `uses` (catalog ids), `context` (what it may see),
`input`/`output` (plain-words contract), `ceiling` and `defaultAuthority`, `state` + `stateNote`, `evidence`
(every finding names the task fields it came from). Extend by adding a row.

## Authority (graduated)
observe → prepare → anticipate → propose for review → execute. `effectiveAuthority` clamps to the ceiling and
never yields `execute` without explicit human authorization. All ceilings are `propose` today, so no participant
can change anything; this also keeps every effect inside SYNAPSE's four. Raising a ceiling needs a connected
runtime and a decision, not a code default.

## Flow
1. `workKind(task)` classifies the work. 2. `propose(task)` picks tools and frameworks (unchanged).
3. `coordinate(state, task, now, kind)` selects specialists by work kind and task signals (dependencies, due date,
owner, review step), each with a reason; gathers `reading`s; derives conflicts, missing inputs, and decisions for a person.
4. The person selects specialists and authority, then approves: one history line is written through the existing
`task/comment` action. 5. Templates store capabilities and specialists, per person.

## Future integration contract (not built)
A model-backed participant would implement `reading`'s shape: input = the permitted `context` keys only; output = `Finding[]`
with `evidence` pointing at task fields or sources; no side effects. Requirements before any claim of intelligence:
1. A decided model route and a connected provider. 2. A confirmed QBIO/NAN contract (what QBIO sends, what NAN stores,
who owns memory) agreed with QuestBase's Director. 3. Server-side permission checks on the context handed over.
4. A per-participant ceiling raise recorded as a decision. 5. A fallback to the rule-based reading, as Clarify has.
