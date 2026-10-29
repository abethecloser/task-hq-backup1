import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ITEMS, addItem, joinChecklist, removeItem, splitChecklist, toggleItem, withNotes } from './checklist.ts';

test('a description without a trailing checklist is all notes', () => {
  assert.deepEqual(splitChecklist('Check the site plan.'), { notes: 'Check the site plan.', items: [] });
  // A list in the middle of the notes is notes, not a checklist.
  assert.equal(splitChecklist('- [ ] mid\nThen more text').items.length, 0);
});

test('items round-trip, and notes above keep their exact text', () => {
  const notes = 'Ask @Maya about the #permits window.';
  let d = addItem(notes, 'Order shingles')!;
  d = addItem(d, 'Confirm drop zone')!;
  assert.equal(d, `${notes}\n\nChecklist:\n- [ ] Order shingles\n- [ ] Confirm drop zone`);
  d = toggleItem(d, 0);
  assert.deepEqual(splitChecklist(d), { notes, items: [{ text: 'Order shingles', done: true }, { text: 'Confirm drop zone', done: false }] });
  assert.ok(d.startsWith(notes), 'note offsets unchanged');
  d = removeItem(d, 0);
  assert.deepEqual(splitChecklist(d).items, [{ text: 'Confirm drop zone', done: false }]);
  assert.equal(removeItem(d, 0), notes, 'removing the last item removes the block');
});

test('editing notes keeps the checklist; a checklist with no notes stands alone', () => {
  const d = joinChecklist('', [{ text: 'Photos', done: false }]);
  assert.equal(d, 'Checklist:\n- [ ] Photos');
  assert.equal(withNotes(d, 'New context'), 'New context\n\nChecklist:\n- [ ] Photos');
  assert.equal(splitChecklist('Checklist:\n- [X] Upper case counts').items[0]!.done, true);
});

test('blank items and overly long lists are refused', () => {
  assert.equal(addItem('', '   '), null);
  let d = '';
  for (let i = 0; i < MAX_ITEMS; i++) d = addItem(d, `Item ${i}`)!;
  assert.equal(addItem(d, 'One too many'), null);
});

test('Markdown checkboxes without the Checklist header stay notes', () => {
  const legacy = 'Before the crew arrives:\n- [ ] Move the cars\n- [x] Unlock the side gate';
  assert.deepEqual(splitChecklist(legacy), { notes: legacy, items: [] });
  assert.deepEqual(splitChecklist('- [ ] Only a checkbox line'), { notes: '- [ ] Only a checkbox line', items: [] });
  // Adding a step keeps the old lines as notes and starts a real checklist after them.
  const next = addItem(legacy, 'Photo the roof')!;
  assert.equal(next, `${legacy}\n\nChecklist:\n- [ ] Photo the roof`);
  assert.deepEqual(splitChecklist(next), { notes: legacy, items: [{ text: 'Photo the roof', done: false }] });
  assert.equal(withNotes(legacy, legacy), legacy, 'saving the notes unchanged leaves the description unchanged');
});
