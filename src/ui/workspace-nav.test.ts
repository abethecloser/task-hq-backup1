// One workspace navigator: the wide-screen panel and the phone menu render the same WorkNavigator,
// it stays available on the Calendar page, and archived records render grayed out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('the panel and the phone menu share one navigator with nested task views, projects and Archive', () => {
  const app = read('../app/App.tsx'), sidebar = read('../app/Sidebar.tsx'), nav = read('../app/WorkNavigator.tsx');
  assert.match(app, /navigator=\{workNavigator\}/, 'phones get the navigator as their menu');
  assert.match(app, /navigator=\{workNavigator\}/, 'the sidebar gets one navigator for both wide screens and phones');
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
  // Calendar in the navigation (rail, tree, phone tab bar) is the full page; only the toolbar opens the drawer.
  assert.match(app, /if \(next === 'calendar' && calOpen\) closeRightPanel\(\);/, 'going to the Calendar page closes the drawer');
  assert.doesNotMatch(app, /item\.id === 'calendar' \? openCalendar\(\)/, 'the tab bar Calendar navigates, it does not open the drawer');
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

test('one sidebar, two states: collapsed icons, expanded icon + label rows in the same place, never both', () => {
  const sidebar = read('../app/Sidebar.tsx'), nav = read('../app/WorkNavigator.tsx'), app = read('../app/App.tsx');
  // Same records, same groups and order in both states.
  assert.match(sidebar, /groupSections\(everyday\)\.map\(group => <div key=\{group\.label\} className="rail-group"/);
  assert.match(nav, /const grouped = groupSections\(sections\);/);
  assert.match(app, /const railItems = sidebar\.isMobile \? navigation : navigation\.filter\(item => item\.id !== 'settings'\);/);
  // Expanded replaces the icon column with the navigator inside the same rail; no panel beside it.
  assert.match(sidebar, /\{expanded \? <div className="rail-tree">\{navigator\}<\/div> : <nav className="nav"/);
  assert.match(sidebar, /const panelHidden = isMobile \? !control\.mobileOpen : true;/);
  assert.match(sidebar, /'--panel-offset': '0px', \.\.\.\(!isMobile && prefs\.open \? \{ '--rail': `\$\{prefs\.width\}px` \} : \{\}\)/);
  assert.match(nav, /<span className="work-nav-icon" aria-hidden="true">\{item\.icon\}<\/span><span className="work-nav-text">\{item\.label\}<\/span>/, 'expanded rows: icon with label');
});

test('navigation always lands on the page: Home never keeps a task, project room or draft on top', () => {
  const app = read('../app/App.tsx');
  assert.match(app, /function go\(next: View\) \{[\s\S]{0,200}setTaskId\(null\);\n\s*setRoomId\(null\);\n\s*setCreating\(false\);/);
});

test('the sidebar header chevron expands and collapses it; the preference and open folders are remembered', () => {
  const sidebar = read('../app/Sidebar.tsx'), nav = read('../app/WorkNavigator.tsx'), app = read('../app/App.tsx');
  assert.match(sidebar, /className="rail-collapse" onClick=\{\(\) => \{ setHint\(null\); control\.toggle\(\); \}\}/, 'chevron inside the sidebar header');
  assert.doesNotMatch(app, /className="seam seam-left"/, 'no separate far-left edge toggle');
  assert.match(sidebar, /open: typeof raw\.open === 'boolean' \? raw\.open : false,/, 'expanded/collapsed is remembered');
  // Tasks and Projects are folders: the row unfolds and opens the page; the chevron folds without navigating.
  assert.match(nav, /onClick=\{\(\) => \{ if \(parent\) setExpanded\(item\.id, true\); onSelect\(item\.id\); \}\}/);
  assert.match(nav, /className=\{`work-nav-fold \$\{unfolded \? 'is-open' : ''\}`\} aria-expanded=\{unfolded\}/);
  assert.match(nav, /const OPEN_KEY = 'quest\.nav\.expanded';/);
});
