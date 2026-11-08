import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSnapshot, delegate, delegationNote, noProvider, viewFor } from './org-capabilities.ts';
import type { ContextScope, OrgBrain } from './org-capabilities.ts';
import { SAMPLE_ORG, fixtureProvider } from './org-fixtures.ts';
import { analyze, workbenchNote } from './workbench.ts';
import { blankTask, seedState } from './seed.ts';

const T0 = new Date('2026-11-08T09:00:00').getTime();
const PERSONAL: ContextScope = { kind: 'personal', id: 'alexia', name: 'Alexia’s QuestSpace' };
const task = (title: string, nextAction = '') => blankTask('t1', { title, nextAction, owner: 'alex', projectId: seedState(T0).projects[0]!.id }, 'alex', T0);

test('with no provider the answer is empty and says so; nothing is invented', async () => {
  const snap = await noProvider(SAMPLE_ORG);
  assert.equal(snap.source, 'none'); assert.deepEqual(snap.brains, []);
  const view = viewFor(snap, 'communicate');
  assert.match(view.note, /QuestBase has not provided/); assert.deepEqual(view.suggested, []);
});

test('a snapshot for another context is refused: personal and organization are never mixed', () => {
  const raw = { context: PERSONAL, source: 'questbase', brains: [], fetchedAt: 1 };
  assert.throws(() => checkSnapshot(raw, SAMPLE_ORG), /different context/);
  assert.throws(() => checkSnapshot({ ...raw, context: { ...SAMPLE_ORG, id: 'other-org' } }, SAMPLE_ORG), /different context/);
  assert.throws(() => checkSnapshot(null, SAMPLE_ORG), /malformed/);
  assert.throws(() => checkSnapshot({ ...raw, context: SAMPLE_ORG, source: 'made-up' }, SAMPLE_ORG), /unknown source/);
});

test('provider output is untrusted: duplicates and nameless brains dropped, unknown ceiling and state made safe', () => {
  const raw = { context: SAMPLE_ORG, source: 'questbase', fetchedAt: 5, brains: [
    { id: 'a', name: 'A', ceiling: 'god-mode', state: 'running-wild', suits: ['plan'] },
    { id: 'a', name: 'Dup', ceiling: 'execute', state: 'connected', suits: [] },
    { id: '', name: 'No id' }, { id: 'b' }, null,
  ] };
  const snap = checkSnapshot(raw, SAMPLE_ORG);
  assert.deepEqual(snap.brains.map(b => b.id), ['a']);
  assert.equal(snap.brains[0]!.ceiling, 'observe'); assert.equal(snap.brains[0]!.state, 'unavailable');
});

test('a persistent organizational brain is independent of tasks, and each environment has its own', async () => {
  const org1 = await fixtureProvider(SAMPLE_ORG); const org2 = await fixtureProvider(SAMPLE_ORG);
  assert.deepEqual(org1.brains, org2.brains, 'same brains however often and for whichever task');
  assert.ok(org1.brains.length >= 5 && org1.brains.some(b => b.id === 'org.finance'));
  assert.ok(JSON.stringify(org1).indexOf('t1') === -1, 'the snapshot carries no task data');
  const personal = await fixtureProvider(PERSONAL);
  assert.ok(personal.brains.length >= 1);
  const orgIds = new Set(org1.brains.map(b => b.id));
  assert.ok(personal.brains.every(b => !orgIds.has(b.id)), 'no shared identities across contexts');
  assert.equal(org1.source, 'fixture'); assert.match(org1.brains[0]!.stateNote, /Not provided by QuestBase/);
  assert.deepEqual((await fixtureProvider({ kind: 'organization', id: 'someone-else', name: 'X' })).brains, [], 'an organization without a configuration gets nothing');
});

test('a task discovers the relevant organizational brains, and unusable ones are named, not offered', async () => {
  const org = await fixtureProvider(SAMPLE_ORG);
  const dispute = viewFor(org, 'communicate');
  const names = dispute.suggested.map(s => s.brain.name);
  assert.ok(names.includes('Finance') && names.includes('Sales'), names.join(','));
  assert.ok(dispute.suggested.every(s => s.why.length > 10));
  const research = viewFor(org, 'research');
  assert.ok(!research.suggested.some(s => s.brain.id === 'org.marketing'), 'unavailable brain is not offered');
  assert.ok(research.unusable.some(u => u.brain.id === 'org.marketing' && /Not configured/.test(u.why)));
});

test('delegation is human-granted, task-scoped, and never above the brain or role ceiling', async () => {
  const org = await fixtureProvider(SAMPLE_ORG);
  const finance = org.brains.find(b => b.id === 'org.finance') as OrgBrain; // ceiling: prepare
  const base = { task: { id: 't1' }, context: SAMPLE_ORG, brain: finance, roleCeiling: 'propose' as const, roleId: 'resources' as const, requested: 'propose' as const, grantedBy: 'alex', now: T0 };
  const d = delegate(base);
  assert.equal(d.authority, 'prepare', 'clamped to the brain ceiling');
  assert.equal(d.scope, 'task:t1'); assert.equal(d.grantedBy, 'alex');
  assert.equal(delegate({ ...base, brain: org.brains.find(b => b.id === 'org.sales')!, requested: 'observe' }).authority, 'observe', 'a lower request is respected');
  assert.equal(delegate({ ...base, brain: org.brains.find(b => b.id === 'org.sales')!, roleCeiling: 'observe' }).authority, 'observe', 'clamped to the role ceiling');
  assert.equal(delegate({ ...base, brain: org.brains.find(b => b.id === 'org.sales')!, requested: 'execute' }).authority, 'propose', 'execute never without explicit authorization');
  assert.throws(() => delegate({ ...base, grantedBy: '  ' }), /must name the person/, 'no self-delegation');
  assert.throws(() => delegate({ ...base, brain: org.brains.find(b => b.id === 'org.marketing')! }), /cannot be delegated to/);
});

test('analysis with a snapshot adds the organization view and leaves tool selection and specialists unchanged', async () => {
  const state = seedState(T0); const t = task('Dispute klarna charge', 'Call Klarna');
  const plain = analyze(state, t, T0);
  const withOrg = analyze(state, t, T0, undefined, await fixtureProvider(SAMPLE_ORG));
  assert.deepEqual(withOrg.proposal, plain.proposal); assert.deepEqual(withOrg.brief, plain.brief);
  assert.equal(plain.org, undefined);
  assert.ok(withOrg.org!.suggested.length > 0 && withOrg.org!.context.kind === 'organization');
});

test('the traceable record names who authorized what, for which context, and for this task only', () => {
  const org = delegationNote([{ name: 'Finance', authority: 'prepare' }], SAMPLE_ORG, 'Alexia');
  assert.match(org, /Organization capabilities \(Sample roofing company\): Finance \(prepare\)\. Authorized by Alexia for this task only\./);
  assert.match(delegationNote([{ name: 'My focus', authority: 'prepare' }], PERSONAL, 'Alexia'), /Personal capabilities/);
  assert.equal(delegationNote([], SAMPLE_ORG, 'Alexia'), '');
  assert.match(workbenchNote(['Calendar'], 'plan', [], org), /Finance \(prepare\)/);
});
