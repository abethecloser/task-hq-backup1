import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Synthetic presentation checks only. No backend or operational writes.
const server = await createServer({ configFile: false, plugins: [react()], cacheDir: '/private/tmp/quest-b03-vite-cache', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error' });
try {
  const { Home } = await server.ssrLoadModule('/src/app/Home.tsx');
  const { CompanyWork } = await server.ssrLoadModule('/src/app/CompanyWork.tsx');
  const { seedState, blankTask } = await server.ssrLoadModule('/src/core/seed.ts');
  const now = Date.now();
  const state = seedState(now);
  const noop = () => {};
  const callbacks = Object.fromEntries(['onUnseen', 'onOpen', 'onOpenLead', 'onOpenMention', 'onCreate', 'onRegistry', 'onDeck', 'onTeam', 'onActivity'].map(key => [key, noop]));
  const quest = actor => ({ state, actor, now, backend: { kind: 'local', supports: {} }, dispatch: () => { throw Error('Presentation must not dispatch'); } });
  for (const [actor, company, canCreate] of [['jordan', true, true], ['maya', true, true], ['alex', false, false]]) {
    const html = renderToStaticMarkup(createElement(Home, { ...callbacks, quest: quest(actor), company, canCreate, canDeck: false, unseen: { count: 0 }, mentions: [], read: new Set() }));
    assert.match(html, /Open next task|Review next lead|Review approval|Review blocker|Review help request/);
    const hero = html.split('hd-top')[0];
    assert.match(hero, /btn-primary[^>]*>(Open|Review)/);
    if (canCreate) assert.ok(hero.indexOf('btn-primary') < hero.indexOf('+ New task'));
    else assert.doesNotMatch(hero, /New task/);
  }
  state.tasks = [];
  state.leads = [];
  const clear = renderToStaticMarkup(createElement(Home, { ...callbacks, quest: quest('alex'), company: false, canCreate: true, canDeck: false, unseen: { count: 0 }, mentions: [], read: new Set() }));
  assert.doesNotMatch(clear, /Open next task|Review next lead|Review approval|Review blocker|Review help request/);
  assert.match(clear, /btn-primary[^>]*>\+ New task/);
  const task = blankTask('b03', { title: 'Confirm site access', owner: 'alex', projectId: 'northside' }, 'maya', now);
  state.tasks = [task];
  const project = () => renderToStaticMarkup(createElement(CompanyWork, { quest: quest('maya'), onOpen: noop }));
  assert.match(project(), /1 task/);
  assert.match(project(), /First by urgency/);
  task.status = 'blocked';
  assert.match(project(), /1 blocked/);
  assert.match(project(), /First by urgency/);
  assert.doesNotMatch(project(), /Open priority task/);
  task.status = 'done';
  assert.match(project(), /No tasks match these filters/);
  assert.doesNotMatch(project(), /Open priority task/);
  // Isolated situations keep the label assertions independent of seed ranking.
  const home = () => renderToStaticMarkup(createElement(Home, { ...callbacks, quest: quest('alex'), company: false, canCreate: false, canDeck: false, unseen: { count: 0 }, mentions: [], read: new Set() }));
  task.status = 'ready';
  assert.match(home(), /btn-primary[^>]*>Open next task/);
  task.status = 'blocked';
  assert.match(home(), /btn-primary[^>]*>Review blocker/);
  task.blocker = { helper: 'alex', by: 'maya', note: 'Need site access', at: now };
  task.owner = 'maya';
  assert.match(home(), /btn-primary[^>]*>Review help request/);
  task.status = 'review';
  task.owner = 'maya';
  task.approver = 'alex';
  assert.match(home(), /btn-primary[^>]*>Review approval/);
  task.status = 'done';
  assert.doesNotMatch(home().split('hd-top')[0], /btn-primary/);
  state.tasks = Array.from({ length: 6 }, (_, i) => blankTask(`risk-${i}`, { title: `Risk ${i}`, owner: 'alex', status: 'blocked' }, 'maya', now));
  state.tasks.forEach(task => { task.status = 'blocked'; });
  const riskPanel = home().split('aria-labelledby="hd-risk"')[1].split('</section>')[0];
  assert.match(riskPanel, /View all \(6\)/);
  assert.equal((riskPanel.match(/class="hd-row is-risk"/g) || []).length, 4);
  state.tasks = state.tasks.slice(0, 4);
  assert.doesNotMatch(home().split('aria-labelledby="hd-risk"')[1].split('</section>')[0], /View all/);
  const { NotificationDrawer, Thread } = await server.ssrLoadModule('/src/app/NotificationDrawer.tsx');
  const drawerCallbacks = Object.fromEntries(['onClose', 'onOpenTask', 'onOpenLead', 'onOpenInbox', 'onOpenAttention', 'onOpenActivity'].map(key => [key, noop]));
  for (const tab of ['inbox', 'attention', 'activity']) {
    for (const open of [false, true]) {
      const html = renderToStaticMarkup(createElement(NotificationDrawer, {
        ...drawerCallbacks, quest: quest('maya'), open, threadAllowed: () => false,
        control: { tab, isMobile: false, read: new Set(), setTab: noop, markRead: noop, afterNavigate: noop },
        inbox: { items: [], unread: 0, sources: [], byWorkspace: [] }, attention: { items: [], mine: 0, snoozed: 0 },
      }));
      assert.match(html, new RegExp(`is-${open ? 'open' : 'closed'}`));
      assert.match(html, new RegExp(`aria-hidden="${!open}"`));
      assert.equal(html.includes('inert=""'), !open);
      assert.match(html, new RegExp(`role="tabpanel" id="aware-panel-${tab}"`));
      assert.doesNotMatch(html, /aria-modal/);
    }
  }
  const locked = renderToStaticMarkup(createElement(Thread, { quest: quest('maya'), taskId: state.tasks[0].id, allowed: false, onBack: noop, onClose: noop, onOpenTask: noop }));
  assert.match(locked, /outside your Critical Focus/);
  assert.doesNotMatch(locked, /Reply to this task|>Open task</);
  for (const count of [4, 11, 101]) {
    const html = renderToStaticMarkup(createElement(NotificationDrawer, {
      ...drawerCallbacks, quest: quest('maya'), open: true, threadAllowed: () => true,
      control: { tab: 'inbox', isMobile: false, read: new Set(), setTab: noop, markRead: noop, afterNavigate: noop },
      inbox: { items: [], unread: count, sources: [], byWorkspace: [] }, attention: { items: [], mine: count, snoozed: 0 },
    }));
    const label = count > 99 ? '99+' : String(count);
    assert.ok(html.includes(`aware-count">${label}</span>`) && html.includes(`aware-count is-hot">${label}</span>`));
    assert.match(html, /aware-tab-activity/);
  }
  console.log('PASS B03 count fixtures: 4, 11 and 100+ (existing 99+ cap).');
  const { AskTasks } = await server.ssrLoadModule('/src/app/AskTasks.tsx');
  for (const open of [false, true]) {
    const html = renderToStaticMarkup(createElement(AskTasks, { quest: quest('alex'), company: false, open, onClose: noop }));
    assert.match(html, /edge-drawer ask-panel/);
    assert.equal(html.includes('inert=""'), !open);
    assert.match(html, /Ask a question/);
    assert.match(html, /ask-chips/);
  }
  console.log('PASS B03.4: shared Ask drawer, suggestions, input and closed inert state.');
  console.log('PASS B03.3: open and inert closed drawer, all three tab panels, restricted thread.');
  console.log('PASS B03: owner/coordinator/employee Home priority, creation permission, empty queue, project synopsis, blocked and completed exceptions.');
} finally {
  await server.close();
}
