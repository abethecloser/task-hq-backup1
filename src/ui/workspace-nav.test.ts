// One workspace navigator: the wide-screen panel and the phone menu render the same WorkNavigator,
// it stays available on the Calendar page, and archived records render grayed out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('the panel and the phone menu share one navigator with nested task views, projects and Archive', () => {
  const app = read('../app/App.tsx'), sidebar = read('../app/Sidebar.tsx'), nav = read('../app/WorkNavigator.tsx');
  assert.match(app, /navigator=\{workNavigator\}/, 'phones get the navigator as their menu');
  assert.match(app, /pullout=\{<div className="left-stack">\{workNavigator\}<\/div>\}/, 'the wide-screen panel shows the same navigator, and only navigation');
  assert.match(sidebar, /\{navigator\}/);
  assert.doesNotMatch(sidebar, /panelItem/, 'no second, flat phone list');
  assert.match(nav, /'archive', 'people', 'settings'/, 'Archive is part of the hierarchy');
  assert.match(nav, /aria-label="Task views"/); assert.match(nav, /aria-label="Projects"/);
});

test('the calendar lives in the right panel: top-right icon, not the left panel or the rail', () => {
  const app = read('../app/App.tsx'), top = read('../app/TopBar.tsx');
  assert.doesNotMatch(read('home.css'), /is-calendar-page \.workspace-panel \{ display: none/);
  assert.equal(app.match(/<CalendarPullout /g)?.length, 1, 'one calendar quick view, in the right panel');
  assert.match(app, /<div className="right-slot right-calendar" hidden=\{!calendarShown\}>/);
  assert.doesNotMatch(app, /item\.id === 'calendar' \|\| !topSections/, 'no Calendar icon in the rail');
  // One right panel: opening any of Calendar, Ask or Notifications closes the other two.
  assert.match(app, /setNotifOpen\(false\); setAskOpen\(false\); setCalOpen\(true\);/);
  assert.match(app, /setNotifOpen\(false\); setCalOpen\(false\);\n\s*setAskOpen\(true\);/);
  assert.match(app, /setAskOpen\(false\); setCalOpen\(false\);\n\s*prepareRightPanel\(\);/);
  // Toolbar order: Ask, Calendar, Notifications.
  const ask = top.indexOf('data-edge="ask"'), cal = top.indexOf('data-edge="calendar"'), bell = top.indexOf('data-edge="updates"');
  assert.ok(ask > 0 && ask < cal && cal < bell);
});

test('archived tasks and projects render grayed out under their Archived banner', () => {
  assert.match(read('../app/TaskPage.tsx'), /task\.archivedAt && !draft \? 'is-archived-record'/);
  assert.match(read('../app/ProjectRoom.tsx'), /project\.archivedAt \? 'is-archived-record'/);
  assert.match(read('nexus.css'), /\.is-archived-record > :not\(\.tp-bar\):not\(\.tp-legacy\):not\(\.pr-archived\) \{ filter: grayscale\(1\)/);
});
