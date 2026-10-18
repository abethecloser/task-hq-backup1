// Quest OS executive demo on SYNTHETIC Task-HQ demo data. Reads and writes nothing
// outside this process: no Supabase, no browser storage, no network.
//
//   node scripts/executive-demo.ts                      full walkthrough
//   node scripts/executive-demo.ts --ask "Who needs me?"   one command
//   node scripts/executive-demo.ts --principal maya     another person's desk
//
// In the demo workspace “Abraham” is a reviewer persona with no operational
// authority, so the executive desk is shown for Jordan Lee (Operations Manager)
// as the synthetic stand-in. In a live workspace the principal is the signed-in
// owner, and the engine decides what their role may do.
import type { Action, QuestState } from '../src/core/contract.ts';
import { apply } from '../src/core/engine.ts';
import { seedState } from '../src/core/seed.ts';
import { actionFor } from '../src/core/capabilities.ts';
import { dailySignal, decisionDesk, executiveBrief, followUps } from '../src/core/executive.ts';
import type { Decision } from '../src/core/executive.ts';
import { EXEC_COMMANDS, runExecCommand } from '../src/core/executive-commands.ts';
import { nameOf } from '../src/core/selectors.ts';
import { MINUTE } from '../src/core/time.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const principal = flag('--principal') ?? 'jordan';
const ask = flag('--ask');

// A fixed synthetic morning, so every run prints the same thing.
const T0 = new Date('2026-10-17T07:00:00').getTime();
let state: QuestState = seedState(T0);
let n = 0;
function act(actor: string, action: Action, at: number) {
  const result = apply(state, action, { actor, now: at, newId: () => `demo-${++n}`, writer: 'demo' });
  if (!result.ok) throw new Error(`${actor} ${action.type}: ${result.error}`);
  state = result.state;
}
const lastBriefing = T0 + 5 * MINUTE;
act('maya', { type: 'task/advance', id: 'staging-area' }, T0 + 20 * MINUTE);
act('alex', { type: 'task/advance', id: 'crew-handoff' }, T0 + 35 * MINUTE);
act('sam', { type: 'lead/escalate', id: 'lead-brightline', note: 'Wants a commercial discount before booking' }, T0 + 50 * MINUTE);
act('alex', { type: 'task/request-help', id: 'safety-brief', note: 'Do we replace the two frayed harnesses?', helper: 'jordan' }, T0 + 70 * MINUTE);
act('jordan', { type: 'ultra/activate', taskId: 'maple-tarp' }, T0 + 80 * MINUTE);
act('alex', { type: 'grant/request', section: 'leads', reason: 'Okafor family asked for me by name' }, T0 + 85 * MINUTE);
const now = T0 + 90 * MINUTE;

const line = (text = '') => console.log(text);
const rule = (title: string) => line(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);

if (ask) {
  const reply = runExecCommand(state, { text: ask, modality: 'text', principal, now, since: lastBriefing });
  line(reply.kind === 'action' ? reply.preview : reply.kind === 'unsupported' ? reply.message : reply.answer);
  process.exit(0);
}

line('QUEST OS · EXECUTIVE DEMO — SYNTHETIC DATA (Task-HQ demo workspace, no live records)');
line(`Principal: ${nameOf(state, principal)}${principal === 'jordan' ? ' (stand-in for the executive; see header comment)' : ''}`);

const brief = executiveBrief(state, now, principal, { since: lastBriefing });
rule('EXECUTIVE BRIEF');
line(brief.headline);
for (const section of brief.sections) {
  line(`\n${section.label}${section.status !== 'ok' ? ` [${section.status}]` : ''}${section.items.length ? ` (${section.items.length})` : ''}`);
  if (section.note) line(`  ${section.note}`);
  for (const item of section.items) line(`  ${item.needsPrincipal ? '★' : '·'} ${item.text}${section.key !== 'decisions' && item.onDesk ? ' (on your decision desk)' : item.needsPrincipal ? '' : `  → ${nameOf(state, item.handler, 'the team')}`}  [${item.source.kind}:${item.source.id}]`);
}

const desk = decisionDesk(state, now, principal);
rule(`DECISION DESK (${desk.length})`);
const show = (decision: Decision, index: number) => {
  line(`\n${index + 1}. [${decision.urgency}] ${decision.what}`);
  line(`   Why: ${decision.why}`);
  line(`   Waiting: ${decision.waiting.map(item => item.label).join(', ') || '—'}`);
  line(`   If it waits: ${decision.delay}`);
  line(`   Recommended: ${decision.recommendation}`);
  for (const option of decision.options) line(`   ${option.recommended ? '→' : ' '} ${option.label} (${option.kind})${option.supported ? '' : ` — not available: ${option.refusal}`}`);
};
desk.forEach(show);

rule('FOLLOW-UP INTELLIGENCE');
for (const item of followUps(state, now, principal)) line(`${item.needsPrincipal ? '★' : '·'} [${item.kind}] ${item.what} → ${item.suggestion}${item.needsPrincipal ? '' : ` (${nameOf(state, item.handler, 'the team')})`}`);

const signal = dailySignal(state, now);
rule('DAILY SIGNAL');
line(signal.summary);
for (const entry of signal.entries) line(`  ${new Date(entry.at).toTimeString().slice(0, 5)}  ${entry.text}  [event:${entry.source.id}]`);
line('Sources: ' + signal.sources.map(item => `${item.label} — ${item.status}`).join('; '));

rule('VOICE-FIRST COMMANDS (typed text today)');
for (const command of EXEC_COMMANDS) {
  const text = command.examples[0]!;
  const reply = runExecCommand(state, { text, modality: 'text', principal, now, since: lastBriefing, subject: command.id === 'assign' ? { taskId: 'shingle-order' } : undefined });
  line(`\n“${text}”`);
  line(`  ${reply.kind === 'action' ? reply.preview : reply.spoken}`);
}

// Confirm each recommended option, the way the principal would with one tap each.
rule('AFTER CONFIRMING EACH RECOMMENDATION');
for (const decision of desk) {
  const option = decision.options.find(item => item.recommended);
  if (!option?.supported) continue;
  const values = Object.fromEntries((option.offer?.inputs ?? []).map(input => [input.name, input.kind === 'date' ? '2026-10-18' : input.required ? 'Confirmed by demo' : '']));
  const action = option.offer ? actionFor(option.offer, values, principal)! : option.action!;
  act(principal, action, now + MINUTE);
  line(`✓ ${decision.what} → ${option.label}`);
}
const after = executiveBrief(state, now + 2 * MINUTE, principal);
line(`\n${after.headline}`);
const remaining = decisionDesk(state, now + 2 * MINUTE, principal);
line(`Desk: ${desk.length} → ${remaining.length} decision(s). Brief “needs you”: ${brief.needsYou} → ${after.needsYou}.`);
for (const decision of remaining) line(`  still open: ${decision.what}`);
