import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('signing in opens the workspace directly; no check-in page stands in front of it', () => {
  const gate = read('Workday.tsx');
  assert.match(gate, /useState<'work' \| 'panel'>\(\(\) => \(canCheckIn && location\.hash === WORKDAY_ROUTE \? 'panel' : 'work'\)\)/, 'entry is the workspace unless the shift panel was asked for');
  assert.doesNotMatch(gate, /'gate'|'checking'/, 'no gate or blocking status check on entry');
  // Shift status never blocks: a failed status load is shown inside the panel, not instead of the work.
  assert.match(gate, /return <WorkdayContext\.Provider value=\{canCheckIn \? workday : null\}>\{children\}<\/WorkdayContext\.Provider>;/);
  // The live root still wraps the app in the workday provider, so shift tools stay available.
  assert.match(read('../live/LiveRoot.tsx'), /<WorkdayGate /);
});

test('shift management stays reachable on request: account menu, task page, badge scan', () => {
  assert.match(read('../app/TopBar.tsx'), /workday\.open\(\)/, 'account menu: Check in / Check out');
  assert.match(read('../app/TaskPage.tsx'), /onClick=\{workday\.open\}/, 'task page: Clock in on this task');
  assert.match(read('../main.tsx'), /history\.replaceState\(null, '', WORKDAY_ROUTE\)/, 'a badge scan opens the shift panel');
  assert.match(read('Workday.tsx'), /<ShiftModule backend=\{shifts\}/, 'the shift module itself is unchanged and still rendered');
});

test('only the explicit Clock in button starts a shift; entering, reading or opening tasks never does', () => {
  const sources = ['Workday.tsx', 'ShiftBridge.tsx', '../live/LiveRoot.tsx', '../app/App.tsx', '../app/TaskPage.tsx', '../app/TopBar.tsx']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8'));
  for (const source of sources) assert.doesNotMatch(source, /check_in/, 'no check-in outside the shift module button');
  const module = readFileSync(new URL('ShiftModule.tsx', import.meta.url), 'utf8');
  assert.equal(module.match(/run\('check_in'/g)?.length, 1, 'exactly one check-in call, on the Clock in button');
});
