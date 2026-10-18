# Podio Construction → Task-HQ: import preview (read-only)

Prepared 2026-10-17 from existing files only. Nothing was fetched from Podio, nothing in Podio was changed, and nothing was imported into Task-HQ.

This document holds counts and mappings only. Client names and contact details stay in the collector's private output folder (`~/Projects/bigQ/quest-podio-collector/podio-output/`, mode 600).

**Source:**
- Podio org *Sell Now Home Solutions*, workspace **Construction** (10185907).
- Reused, not rebuilt: the collector, the `job-index.json` import, `bid-queue.json`, `priority-readiness.json`, the schema inventory, and the Construction → QuestBase source map.

## 1. What actually exists

| Source | Records | Live-verified? | Notes |
|---|---|---|---|
| Schema inventory (2026-10-13) | 7 apps, 97 fields | ✅ Metadata only | The only successful authenticated Podio read. No records. |
| Job index, from the Excel export "Jobs – Last view used.xlsx" | **569 rows** | ❌ Historical | Created 2024-04-03 → 2026-10-09. **It has no Podio item IDs or job numbers**; Excel row numbers are not IDs. |
| Bid queue (Abraham's urgent list) | 11 names → **18 candidate rows** | ❌ | 4 names match more than one row (2, 2, 2 and 5 candidates). 0 of 18 have an item ID. |
| Priority readiness (the 3 priority jobs named in the collector README) | 3 | ❌ | All **blocked**: identity, final amount and approval are unverified, and the quote amount is blank. |
| Live job extraction (`jobs.json`) | **0** | ❌ | The last run (2026-10-12) ended with "OAuth timed out". |

The review document (2026-10-03) agrees: it was a first-pass browser review, and migration feasibility, permissions and full schemas were not verified.

## 2. Job index quality (569 rows)

- **Missing data:**
  - no client name: 15
  - no phone and no email: 92
  - no project location: 126
  - no title: 139
- **Possible duplicates** (same phone, email or normalized name): **18 clusters covering 43 rows**.
  - By phone: 13 groups. By email: 11 groups. By name: 8 groups.
  - No rows match on name plus location, so these may be repeat clients on different projects rather than duplicates. A person needs to review them; do not auto-merge.
- **Separate status systems** (keep them separate; don't collapse them into one task status):

| Field | Filled | Values |
|---|---|---|
| Client Contact Status | 470 | Contacted 394, Discovery 40, New Untouched 36 |
| Lead Status | 404 | 13 combinations of 6 values (multi-select). Most common: General Follow up 210 |
| Tempretuare (sic) | 341 | Cold 218, Hot 79, Warm 44 |
| AQC Temp | 114 | Dead 48, Hot 34, Cold 20, Warm 12 |
| Status of Bidding | 118 | Accepted 35, Rejected 31, In Queue 20, In Review 11, Awaiting submit 10, Submitted 7, Negotiating 4 |
| Alk Review | 60 | Alk Approved 44, Alk Review 12, Abe Review 4 |
| Status of Project | 33 | Awaiting schedule 13, Completed 10, Started 5, Scheduled 5 |
| Job Status | 29 | Dead Job 23, job finished 6 |

- **Service Requested:** framing and roofing combined 344, roofing only 52, framing only 47, GC 5.
- **Money:** quote amount present on only 19 rows, projected net profit on 15 (all USD). These are original values and are not approved pricing.
- **People in the data:**
  - "Created by": Jobs (app/automation) 268, Ralph Palad 146, Abraham Maldonado 103, alkeith cabezzas 38, plus 2 others.
  - "Member" (a Podio contact field) is set on 27 rows, 18 of them Manny Vargas.
  - None of these people are Task-HQ accounts.

## 3. Field mapping to Task-HQ (proposed)

Task-HQ today has **Tasks** (owner, approver, due, next action, waiting-on, blocker) and **Leads** (name, phone, address, need, stage). It has **no Job or Contact record and no source-ID field**, and live workspaces refuse lead creation until a real lead source is approved.

| Podio Jobs field (app 29519964) | Task-HQ target | Status |
|---|---|---|
| Client Name, Phone, Location | Lead.name, Lead.phone, Lead.address | Fits |
| Client Email | No field | **Gap**: needs a contact field |
| Service Requested | Lead.need | Fits |
| Notes, Scope of Work | Task.description (on a linked follow-up task) | Fits |
| The 8 status fields above | No equivalent; Task-HQ has one task status and one lead stage | **Gap**: keep them as read-only source states |
| Quote Amount, Projected Net Profit | No field | **Gap**: preserve as read-only originals and never treat them as approved |
| Member (contact), Created by | Lead.assignee, Task.owner | **Needs confirmation**: Podio people are not Task-HQ members |
| Podio item ID, app ID, field IDs | No field | **Gap**: a provenance field (`source: podio:10185907:app:29519964:item:<id>`) is required before any import |
| Bid queue "next action" | Task.title / nextAction, unassigned, `waitingOn` = the verification step | Fits as review drafts |

The Contractors, Sub Contractors and both Contractor Prospects apps map to **Contacts**, which Task-HQ doesn't have yet. The Bidding app has 1 configured link to Jobs (29519964), and its record integrity isn't established.

## 4. Needs Abraham's confirmation

1. **Which organization.** The Construction workspace belongs to *Sell Now Home Solutions*. Should it become its own Task-HQ organization (for example "Quest Construction"), a section of Quest Roofing, or neither for now? Nothing is assumed.
2. **Which Jobs app is authoritative:** 29519964 (23 fields; the one the collector and the Bidding link use) or 30858585 (21 fields). The same question applies to the two Contractor Prospects apps (30766746 and 30807603). Don't merge or choose by name.
3. **Which export the 569 rows came from.** The collector resolved Jobs to 29519964, but the Excel file doesn't record its app.
4. **People mapping:** which Podio people (Ralph, Alkeith, Kristin, Jesus, Manny) should be invited to Task-HQ, with which roles. Until then, imported work stays unassigned.
5. **Duplicates:** whether the 18 clusters are the same client or repeat projects. For the 4 ambiguous urgent names, which candidate is the real job.
6. **Scope of the first import:** only the 11 urgent bid items, or all active work (for example, not "Dead Job", "Project Completed" or "Bid Rejected").
7. **Pricing:** confirm that quote amounts stay read-only originals until approved figures exist.

## 5. Smallest safe next step

Get **stable source IDs for a small set**, not the whole app. Every other step depends on IDs; without them nothing can be deduplicated, linked or re-synced safely.

1. **Abraham answers questions 1–3** (organization, authoritative Jobs app, export source). No code is needed.
2. **You run the existing priority collector yourself** in Terminal (`zsh ./podio-collector/authenticate.command`). It's read-only, limited to `space:read` and needs no full-app scan. It reads the 3 priority jobs with real item IDs. The schema inventory proved on 2026-10-13 that OAuth works; the 2026-10-12 job run only timed out waiting for authorization.
3. **Then, still with no production writes,** Task-HQ gets a read-only *staging* view: verified records with their Podio source keys shown beside proposed tasks marked "review draft". Nothing is imported until Abraham approves each mapping. The existing Podio roster/import adapter plan (staging, dedupe, no automatic accounts) covers this.

Not proposed: bulk-importing the 569 Excel rows, creating accounts or invitations from Podio people, two-way sync, or putting anything into Quest Roofing's workspace.
