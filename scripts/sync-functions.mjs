// Copies the Task-HQ engine (src/core) into the dispatch Edge Function so the server
// runs exactly the same rules as the app. Run before tests and before deploying.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
const FILES = ['contract.ts', 'engine.ts', 'seed.ts', 'selectors.ts', 'time.ts', 'workspace.ts', 'rules.ts', 'executive.ts', 'executive-commands.ts', 'capabilities.ts', 'intent.ts', 'deck.ts', 'instruments.ts', 'compose.ts'];
const target = new URL('../supabase/functions/dispatch/core/', import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const file of FILES) copyFileSync(new URL(`../src/core/${file}`, import.meta.url), new URL(file, target));
console.log(`synced ${readdirSync(target).length} engine files into supabase/functions/dispatch/core`);

const automation = new URL('../supabase/functions/dispatch/automation/', import.meta.url);
mkdirSync(automation, { recursive: true });
for (const file of ['contract.ts', 'project.ts', 'executive-interface.ts']) copyFileSync(new URL(`../src/automation/${file}`, import.meta.url), new URL(file, automation));
