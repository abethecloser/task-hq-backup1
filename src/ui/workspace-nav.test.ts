// One workspace navigator: the wide-screen panel and the phone menu render the same WorkNavigator,
// it stays available on the Calendar page, and archived records render grayed out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('the panel and the phone menu share one navigator with nested task views, projects and Archive', () => {
  const app = read('../app/App.tsx'), sidebar = read('../app/Sidebar.tsx'), nav = read('../app/WorkNavigator.tsx');
  assert.match(app, /navigator=\{workNavigator\}/, 'phones get the navigator as their menu');
  assert.match(app, /\{workNavigator\}\n\s*<\/div>\}/, 'the wide-screen panel shows the same navigator');
  assert.match(sidebar, /\{navigator\}/);
  assert.doesNotMatch(sidebar, /panelItem/, 'no second, flat phone list');
  assert.match(nav, /'archive', 'people', 'settings'/, 'Archive is part of the hierarchy');
  assert.match(nav, /aria-label="Task views"/); assert.match(nav, /aria-label="Projects"/);
});

test('the Calendar page keeps the navigator; only the duplicate calendar quick view is left out', () => {
  assert.doesNotMatch(read('home.css'), /is-calendar-page \.workspace-panel \{ display: none/);
  assert.match(read('../app/App.tsx'), /calendarAllowed && view !== 'calendar' && <CalendarPullout/);
});

test('archived tasks and projects render grayed out under their Archived banner', () => {
  assert.match(read('../app/TaskPage.tsx'), /task\.archivedAt && !draft \? 'is-archived-record'/);
  assert.match(read('../app/ProjectRoom.tsx'), /project\.archivedAt \? 'is-archived-record'/);
  assert.match(read('nexus.css'), /\.is-archived-record > :not\(\.tp-bar\):not\(\.tp-legacy\):not\(\.pr-archived\) \{ filter: grayscale\(1\)/);
});
