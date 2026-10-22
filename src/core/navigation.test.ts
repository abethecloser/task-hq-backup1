import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_PAGE_IDS, PAGE_STATUS, pageStatus } from './navigation.ts';

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
