# Task HQ and organizational intelligence: architecture (corrected, QUEST-ARCH-003)

**Synopsis.** The organization's functional intelligence participants ("brains") belong to **QuestBase**, not Task HQ.
Task HQ is the execution instrument: it *consumes* them through an explicit contract, assembles a task workbench, and
records a human's task-scoped delegation. This replaces the earlier TASK-WORKFORCE-001 framing, in which Task HQ's
seven roles read as an organizational workforce. They are now **task-level roles** only.
No model, runtime, NAN or QBIO integration exists or is implied.

## Who owns what
| Level | Owner | Holds |
|---|---|---|
| Organizational | **QuestBase** | Structure, functional areas, human participants, brains and their responsibilities, tools, knowledge, authority boundaries, escalation. The agent registry, principals and grants (QB-ARCH-SPEC-002; ADR-0001 D-A). QBO initialization (not started). Personal QuestSpace and the personal working context. |
| Connective | **QBIO** (QuestBase) | Interprets context; connects the person to the relevant brains, resources and environments. Contract leaves task lifecycle to Task HQ. Not a task engine, not a second workforce. |
| Task | **Task HQ** | Tasks, projects, assignments, dependencies, scheduling, handoffs, execution, history and evidence. Task roles and the workbench. |

One source of truth per fact: Task HQ never stores organizational structure; QuestBase never stores task state.

## What Task HQ built
- `src/core/org-capabilities.ts` is the **consumer contract**: `OrgBrain`, `OrgSnapshot`, `OrgProvider`; `checkSnapshot`
  (provider output is untrusted; wrong context refused); `viewFor` (which brains fit this kind of work; unusable ones named);
  `delegate` / `delegationNote` (human-granted, task-scoped, clamped).
- `src/core/org-fixtures.ts` is a **contract test double**, labelled sample data, used only in the demo and tests. It is not an organization.
- `src/core/participants.ts` are **task roles** (Overseer, planning, operations, scheduling, execution, quality, resources),
  each EXPERIMENTAL: fixed checks over task fields, with evidence.
- `analyze()` returns tool/framework proposal, Overseer brief, and the organization view for the chosen environment.
- The Working setup panel has an **Environment** switch (organization / personal). Contexts are never merged.

## Rules
1. **Authority only goes down.** Delegation <= brain ceiling and <= role ceiling; `execute` never without explicit human authorization and a connected runtime (none exists).
2. **Every delegation names a human** (ADR-0001 D-A). Agent-to-agent delegation is an open Director decision (G3, default no), so a brain can be *proposed*, never self-delegating. Choosing a brain is the person's act; none is pre-selected.
3. **Presence is not autonomy.** A brain in a snapshot carries a `state`; `experimental` or `unavailable` is shown as such.
4. **Stateless runs.** Consistent with ADR-0001 G6: a future run receives a snapshot and returns proposals; it holds no authority.
5. **No provider, no invention.** Live workspaces use `noProvider`: the panel says QuestBase has not provided capabilities.

## Traceability
Approving writes one task-history line through the existing comment action, e.g. *Organization capabilities (Company): Finance (prepare). Authorized by <person> for this task only.*

## What QuestBase must provide (proposed; Director decisions, not built)
1. QBO organization initialization and its schema (migrations are Director-only; QuestBase handoff lists this as NOT STARTED).
2. Brain records in the agent registry: owner humans, purpose, responsibilities, tools, ceiling, state, escalation (ADR-0001 G2 enrolment).
3. A read-only snapshot endpoint per context returning `OrgSnapshot`, authorization checked server-side by QuestBase (`decide()`).
4. The definition of "consequential action" (G4) and the G3 decision on sub-delegation.
5. A QBIO-to-Task HQ context contract: what QBIO passes (task and context scope) and receives; NAN adapter, if any.
6. For a model-backed brain: a decided model route, a recorded ceiling raise, and fallback to the rule-based reading.

## Not demonstrated, and why
- A **real configured organization** and a **persistent brain in QuestBase**: that needs QBO and schema decisions in QuestBase, which this work does not modify. The fixture proves the consumer contract only.
- **QBIO** providing contextual interaction across environments: QBIO lives in QuestBase and has no Task HQ contract yet.
