# Operational tools — takeoff, underwriting, proposals (demo candidate, 2026-10-17)

One record travels: **measurements → priced estimate → approved price → proposal → recorded decision**.
Nothing is retyped between steps. Each step creates real tasks through the task engine.

## Where it lives

| Part | File |
|---|---|
| Formula language (parser, whitelist, rounding, cycles) | `src/core/tools/formula.ts` |
| Pricing engine (one variable-rate model) | `src/core/tools/pricing.ts` |
| Takeoff (measurements, waste, lines, crew) | `src/core/tools/takeoff.ts` |
| Records, rules, approval gate, task requests | `src/core/tools/estimating.ts` |
| Task requests → engine `task/create` / `task/advance` | `src/core/tools/hooks.ts` |
| Synthetic sample settings and records | `src/core/tools/seed.ts` |
| Demo store (per workspace, this browser) | `src/adapter/tools.ts` |
| UI (Estimates & Proposals view) | `src/app/Tools.tsx` |
| Tests (13, mutation-checked) | `src/core/tools/tools.test.ts` |

The tools aren't copied into the dispatch function (`sync-functions.mjs` uses a whitelist), and
they aren't stored in the task workspace document.

## Calculations (verified by tests)

The engine uses a variable-rate model. `v` is the share of the price taken by price-based costs,
`t` is the target margin, and `direct` is material + tax + labor + permits + disposal + other:

- total cost = direct + price × v; margin = (price − total) ÷ price
- price at target = direct ÷ (1 − v − t); break-even = direct ÷ (1 − v)
- max direct at target = price × (1 − v − t); headroom = that − direct

| Formula | v | Matches legacy |
|---|---|---|
| Full burden | overhead + commission + contingency | Native Underwriter (inventory §2 A) — tested |
| Commission only | commission | Estimate builder target quote (§2 C) — tested |

The legacy Underwriting Sheet's "burden" base is **unverified** and isn't modelled.

The formula language supports `+ − × ÷`, brackets, `{references}`, ROUNDUP/ROUNDDOWN/ROUND
(with digits), CEILING/FLOOR (with a multiple), ABS, MIN and MAX. It is parsed and never
executed. Values are snapped to 9 decimals before rounding: 50 SQ at 10% waste is 55, not 56.
Cycles, unknown names, missing measurements and division by zero are each reported on their line.

## Gates

- **Pricing formula starts "not decided".** Every estimate shows both results. No price can be
  approved until a manager records a choice. The demo offers "Use … for this demo", which is
  recorded with who, when, and `demo: true`.
- **Approval is bound to its inputs.** The approval keeps a hash of the costs, rates, price, tier,
  tax and policy. After approval:
  - any edit voids it, and the estimate returns to Draft;
  - changing the formula or review band voids it too.
  Proposals keep their snapshot, but they go on hold and can't be approved or accepted.
- **Approvers:** only configured operational roles may approve (default: manager). The preparer
  can't approve their own price unless the company setting allows it. A named approver is
  waited on.
- **Exceptions:** below target (within the review band) or on a sign-off tier, the approver must
  write a reason. Below the band, the estimate goes to Reprice.
- **Client decision:** a manager records it manually, and it's labelled as such. Task-HQ collects
  no signature. There's no send action and no public link.

## Tasks created (through the engine, idempotent while open)

| Step | Task | Owner |
|---|---|---|
| Ask for measurements | Get roof measurements | chosen person |
| Submit (meets target / review) | Approve price | approver |
| Submit below band / sent back | Reprice | preparer |
| Price approved | Prepare proposal (review task finished) | preparer |
| Proposal sent for review | Approve proposal | approver |
| Proposal approved | Deliver proposal (manual; no send) | preparer |
| Client accepted | Collect deposit · Order materials · Schedule crew | chosen handoff owner |

## Decisions for Abraham before real use

1. Which pricing formula (full burden or commission only), or a different one.
2. The margin tiers and targets, and which tier needs sign-off.
3. The review band (points below target that still go to review).
4. Who approves prices and proposals, and whether a preparer may approve their own.
5. Tax base: material only, or material and labor.
6. Contract wording (warranty, terms) and branding. Proposals say "sample wording" until he approves it.
7. Deposit percentage and how long a proposal stays valid.

## Not built / needs approval

- A live backend: per-row tables `estimates`, `estimate_lines`, `proposals` and `proposal_versions` with org RLS, plus server-side `applyTool` in an Edge Function.
- Uploading report files (needs the storage bucket approval).
- Sending proposals and a client approval link (needs approval, a token design, and rate limiting).
- Multi-trade proposals, partial acceptance and draw schedules (the records leave room for them).
