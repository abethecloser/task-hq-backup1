// Quest extension service worker. It is the single writer for extension data,
// keeps the toolbar badge current, expires temporary access on time, and shows
// local notifications for the person selected in "Working as".
// It does not read, block or control any browser tab.
import type { Action, QuestState } from '../core/contract.ts';
import { audienceFor } from '../core/engine.ts';
import { insightsFor } from '../core/rules.ts';
import { inFocus, nameOf, taskById } from '../core/selectors.ts';
import { ACTOR_KEY, STATE_KEY, chromeKV, ensureState, processAction, processTick } from '../adapter/store.ts';

const LAST_SEEN_KEY = 'quest.notified-through';

chrome.runtime.onMessage.addListener((message: { quest?: string; action?: Action; actor?: string; writer?: string }, _sender, sendResponse) => {
  if (message?.quest !== 'dispatch' || !message.action || !message.actor) return false;
  processAction(chromeKV, message.action, message.actor, message.writer ?? 'extension').then(sendResponse, error => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function refresh() {
  const state = await processTick(chromeKV, 'background');
  const actor = (await chromeKV.get<string>(ACTOR_KEY)) ?? '';
  await updateBadge(state, actor);
  scheduleExpiry(state);
}

async function updateBadge(state: QuestState, actor: string) {
  if (!actor) { await chrome.action.setBadgeText({ text: '' }); return; }
  if (inFocus(state, actor)) {
    await chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: `Task-HQ — Critical Focus: ${taskById(state, state.focus!.taskId)?.title ?? ''}` });
    return;
  }
  const count = insightsFor(state, Date.now(), actor).filter(item => item.severity !== 'normal').length;
  await chrome.action.setBadgeBackgroundColor({ color: '#E8590C' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setTitle({ title: count ? `Task-HQ — ${count} item(s) need you` : 'Task-HQ — My Work' });
}

function scheduleExpiry(state: QuestState) {
  for (const grant of state.grants) {
    if (grant.status === 'approved' && grant.expiresAt && grant.expiresAt > Date.now()) chrome.alarms.create(`grant-${grant.id}`, { when: grant.expiresAt + 250 });
  }
}

async function notifyNewEvents(state: QuestState) {
  const actor = (await chromeKV.get<string>(ACTOR_KEY)) ?? '';
  const seen = (await chromeKV.get<number>(LAST_SEEN_KEY)) ?? Date.now();
  const fresh = state.events.filter(event => event.at > seen).reverse();
  if (fresh.length) await chromeKV.set(LAST_SEEN_KEY, fresh[fresh.length - 1]!.at);
  if (!actor) return;
  // In the demo one person plays every role on one device, so each notification
  // names who it is for instead of only showing those for the current person.
  const NOTIFY: string[] = ['grant', 'ultra', 'approval', 'help', 'handoff', 'lead'];
  for (const event of fresh.slice(-3)) {
    if (!NOTIFY.includes(event.kind)) continue;
    const recipients = event.actor === 'system' ? [event.taskId ? state.focus?.employee ?? '' : ''].filter(Boolean) : audienceFor(state, event);
    const expiredFor = event.id.startsWith('expire-') ? state.grants.find(grant => `expire-${grant.id}` === event.id)?.requester : undefined;
    const names = [...new Set([...recipients, ...(expiredFor ? [expiredFor] : [])])].map(id => nameOf(state, id, ''));
    if (!names.filter(Boolean).length) continue;
    chrome.notifications.create(`quest|${event.taskId ?? ''}|${event.id}`, {
      type: 'basic', iconUrl: 'icons/icon-128.png', priority: event.kind === 'grant' || event.kind === 'ultra' ? 2 : 0,
      title: `Task-HQ · For ${names.filter(Boolean).join(', ')}`,
      message: `${event.text} (local demo — this device only)`,
    });
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (STATE_KEY in changes || ACTOR_KEY in changes) {
    void (async () => {
      const state = await ensureState(chromeKV);
      const actor = (await chromeKV.get<string>(ACTOR_KEY)) ?? '';
      await updateBadge(state, actor);
      scheduleExpiry(state);
      if (STATE_KEY in changes) await notifyNewEvents(state);
    })();
  }
});

chrome.alarms.onAlarm.addListener(() => { void refresh(); });

chrome.notifications.onClicked.addListener(id => {
  const [, taskId] = id.split('|');
  void chrome.tabs.create({ url: chrome.runtime.getURL(`index.html${taskId ? `#/task/${taskId}` : ''}`) });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('quest-tick', { periodInMinutes: 0.5 });
  void chromeKV.set(LAST_SEEN_KEY, Date.now()).then(refresh);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('quest-tick', { periodInMinutes: 0.5 });
  void refresh();
});
