// Copies the Task-HQ engine (src/core) into the dispatch Edge Function so the server
// runs exactly the same rules as the app. Run before tests and before deploying.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
const FILES = ['feedback.ts', 'reference-persistence.ts', 'references.ts', 'reference-index.ts', 'contract.ts', 'engine.ts', 'seed.ts', 'selectors.ts', 'time.ts', 'workspace.ts', 'rules.ts', 'executive.ts', 'executive-commands.ts', 'capabilities.ts', 'intent.ts', 'deck.ts', 'instruments.ts', 'compose.ts'];
const target = new URL('../supabase/functions/dispatch/core/', import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const file of FILES) copyFileSync(new URL(`../src/core/${file}`, import.meta.url), new URL(file, target));
console.log(`synced ${readdirSync(target).length} engine files into supabase/functions/dispatch/core`);

const automation = new URL('../supabase/functions/dispatch/automation/', import.meta.url);
mkdirSync(automation, { recursive: true });
for (const file of ['contract.ts', 'project.ts', 'executive-interface.ts']) copyFileSync(new URL(`../src/automation/${file}`, import.meta.url), new URL(file, automation));

// deploy/dispatch-live/v5 is live in production (deployed 2026-10-21) and frozen: it is not
// synced. v6 (completion state: completedBy, archive) is the next candidate and keeps the
// same nine engine files in sync with src/core.
const v6 = new URL('../deploy/dispatch-live/v6/core/', import.meta.url);
for (const file of readdirSync(v6)) copyFileSync(new URL(`../src/core/${file}`, import.meta.url), new URL(file, v6));
