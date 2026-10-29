# Task-HQ

**Unified experience candidate (2026-10-17):** [what changed, how to verify live, release gates](docs/unified-experience-candidate.md).

**Latest backend candidate (2026-10-17):** [implemented functionality, verification and release gates](docs/quest-os-sprint-results.md). 101 tests, 5 runner guards, 4 rendering groups, web/extension builds and server TypeScript pass. SQL/RLS/concurrency execution awaits an authorized staging database. No production deployment; Construction intake stays disabled.

Adaptive task management for individuals and organizations, plus the **Task-HQ Companion** Chrome extension: one task contract, one set of rules, two surfaces.

**Quest Roofing** is the first customer workspace (roofing & construction preset) and the validation environment, not the product's name.

> The folder is still named `quest-task-management`, and storage keys keep their `quest.*` names, so existing data and the installed extension keep working. Renaming them would need a migration.

## Live (shared) workspace

- **App:** https://task-hq-three.vercel.app. Sign in with a real account, or open the Task-HQ Demo from the sign-in page.
- **Backend:** Supabase `task-hq` (`xthyyxnfjaxmtrqrhyxc`): Auth, Postgres with RLS (`supabase/migrations`), and the `dispatch` Edge Function, the only write path for task data.
- **Deploy the web app:** automatic. Vercel (team `novum-systems`, project `task-hq`) is connected to this repository: merging to `main` deploys production (`task.questroofing.com`), and every other branch or pull request gets a preview deployment. Env `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Production and Preview) hold publishable values only. To roll back, promote an earlier deployment in Vercel.
- **Deploy the server:** `npm run sync:functions && supabase functions deploy dispatch --project-ref xthyyxnfjaxmtrqrhyxc --use-api`.
- **Isolation test:** run `supabase/tests/rls_isolation.sql` in the SQL editor. It rolls back and prints `RESULT pass=… fail=…`.
- **Status, two-user test and open decisions:** see [READINESS.md](READINESS.md).

## Construction intake (local, disabled)

See [intake contract](docs/intake-contract.md) and [verified live/local status](docs/intake-verification-2026-10-17.md). The existing live owner task persistence test passed. Intake has no live source mapping and is not deployed; database checks and dedicated Construction authorization remain required. FormSubmit is unchanged.

## Run it

```sh
cd ~/Projects/bigQ/quest-task-management
npm install          # only needed once
npm run build        # icons + type check + web app (dist/) + Chrome extension (extension/)
npm test             # 34 tests: workflows, composition, instrument deck, feedback/reviewer permissions, extension continuity, server dispatch authority
```

### Install the Task-HQ Companion extension (the main demo)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `~/Projects/bigQ/quest-task-management/extension`.
3. Pin **Task-HQ Companion** to the toolbar (puzzle icon → pin). Shortcut: `Alt+Q` (set or change it at `chrome://extensions/shortcuts`).
4. Click the toolbar icon for the compact popup, or **↗** to open the full Task-HQ app in a tab.

Already installed as “Quest”? Click **reload** on it in `chrome://extensions`. It's the same extension from the same folder, so your data stays.

The full app inside the extension and the popup share the same extension storage, so a change made in one appears in the other right away.

### Standalone web app (optional)

```sh
npm run dev          # http://localhost:5173
```

The standalone web build keeps its own data in that browser's localStorage. It is **separate from the extension's data**, which is why the extension is the main demo.

## Try it

Use **Working as** to play each synthetic person in the Quest Roofing workspace:

| Person | Role | Good for |
| --- | --- | --- |
| Jordan Lee | Operations Manager | Activate Ultra Priority, approve access, approve the Maple estimate |
| Maya Chen | Project Coordinator | Resolve blockers, assign unowned work |
| Alex Morgan | Field Lead | My Work, Move Work Forward, Critical Focus |
| Sam Rivera | Sales | Speed to Lead |
| Riley Brooks | Estimator | Receives inspection handoffs and unlocked work |
| Abraham | Reviewer (local preview) | Browses, leaves feedback and captures; can't change operational work |

Reset everything from **Policy & data → Reset demo workspace**. Workspace name and industry preset (Roofing & construction / General business) are in **Policy & data → Workspace**.

## Layout

```
src/core/       task contract, engine (all state changes), rules (Needs Attention), selectors, seed, migration
                workspace.ts — product identity, customer workspaces (tenant id, kind, plan), industry presets, future entitlements
                compose.ts — situation composer (state + person + time + device → structured situation)
                capabilities.ts — capability registry; every offer is dry-run through the engine
src/adapter/    QuestBackend: chrome.storage (extension) or localStorage (web), serialized writes, outbox
src/ui/         shared hook + components (Move Work Forward, rows, insights, toast) + visual system
src/app/        full Quest app: My Work, Company Work, Needs Attention, Speed to Lead, Activity, Policy & data
src/extension/  popup and background service worker
extension-static/manifest.json   MV3 manifest copied into extension/ at build time
```

See `READINESS.md` for what is real today and what needs authorization before employees use it, and `PROVENANCE.md` for where each capability came from.
