import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_PAGE_IDS, EVERYDAY_PAGES, PAGE_ALIASES, PAGE_STATUS, PREVIEW_PAGES, canonicalPage, pageStatus } from './navigation.ts';

test('every existing application page remains a destination with an explicit live or preview state', () => {
  const expected = ['home', 'reports', 'all-tasks', 'inbox', 'tools', 'company-work', 'needs-attention', 'leads', 'executive', 'people', 'feedback', 'activity', 'settings', 'agents', 'relationships', 'calendar', 'workbook'];
  assert.deepEqual([...APP_PAGE_IDS], expected);
  assert.deepEqual(Object.keys(PAGE_STATUS).sort(), [...expected].sort());
  assert.ok(expected.every(view => pageStatus(view) === 'live' || pageStatus(view) === 'preview'));
});

test('unfinished work is labeled as preview instead of being hidden or presented as a live feature', () => {
  for (const view of ['workbook', 'tools', 'leads', 'relationships', 'feedback', 'agents']) assert.equal(pageStatus(view), 'preview', view);
  for (const view of ['home', 'all-tasks', 'inbox', 'people', 'reports', 'settings']) assert.equal(pageStatus(view), 'live', view);
  assert.equal(pageStatus('future-page'), 'preview', 'unknown destinations fail toward an honest preview label');
});

test('Reports is an alias of the owner overview: old links still open one destination', () => {
  assert.equal(canonicalPage('reports'), 'executive');
  assert.equal(canonicalPage('executive'), 'executive');
  assert.equal(canonicalPage('all-tasks'), 'all-tasks');
  assert.ok(APP_PAGE_IDS.includes('reports'), 'the old id stays a valid destination');
  assert.ok(!EVERYDAY_PAGES.includes('reports'), 'but it is not listed twice in navigation');
});

test('everyday and preview navigation together cover every page exactly once, aliases aside', () => {
  const grouped = [...EVERYDAY_PAGES, ...PREVIEW_PAGES];
  assert.equal(new Set(grouped).size, grouped.length, 'no page is in both groups');
  assert.deepEqual([...grouped].sort(), APP_PAGE_IDS.filter(id => !PAGE_ALIASES[id]).sort());
  assert.deepEqual([...PREVIEW_PAGES].sort(), ['agents', 'feedback', 'leads', 'relationships', 'tools', 'workbook']);
});
