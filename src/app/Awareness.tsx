import { FEEDBACK } from '../core/feedback.ts';
// The sidebar pullout's content: live awareness rather than a second navigation.
//   Inbox      what is addressed to you (unread state; shared with the full Inbox view)
//   Attention  what is wrong right now (rules; reading never resolves it)
//   Activity   what changed (the event log with automatic effects; never unread)
// Rows say what happened, who/what it concerns, when, why it matters and the authorized
// next step. Quick actions are the engine-accepted ones only (see core/awareness.ts).
import { useState } from 'react';
import type { Attention, AttentionItem } from '../core/awareness.ts';
import { activityFor } from '../core/awareness.ts';
import type { InboxItem } from '../core/inbox.ts';
import type { UniversalInbox } from '../core/inbox.ts';
import { INSIGHT_LABELS } from '../core/rules.ts';
import { firstName, taskById } from '../core/selectors.ts';
import { clock } from '../core/time.ts';
import { Avatar } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import type { AwarenessTab, SidebarControl } from './Sidebar.tsx';

const SHOWN = 8;

export function Awareness({ quest, control, inbox, attention, onOpenTask, onOpenThread, onOpenItem, onOpenLead, onOpenInbox, onOpenAttention, onOpenActivity }: {
  quest: Quest; control: SidebarControl; inbox: UniversalInbox; attention: Attention;
  onOpenTask: (id: string) => void;
  /** Inbox task notifications open their conversation here instead of the task page. */
  onOpenThread?: (id: string) => void; onOpenItem?: (item: InboxItem) => void; onOpenLead: (id: string) => void; onOpenInbox: () => void; onOpenAttention: () => void; onOpenActivity: () => void;
}) {
  const { state, now } = quest;
  const tab = control.tab;
  const counts: Record<AwarenessTab, number> = { inbox: inbox.unread, attention: attention.mine, activity: 0 };
  const go = (fn: () => void) => { fn(); control.afterNavigate(); };

  return (
    <section className="aware" aria-label="Live awareness">
      {quest.feedback?.cue && <p className="aware-feedback" role="status">{FEEDBACK[quest.feedback.cue.signature].icon} {FEEDBACK[quest.feedback.cue.signature].label}</p>}
      <div className="aware-tabs" role="tablist" aria-label="Awareness">
        {(['inbox', 'attention', 'activity'] as AwarenessTab[]).map(value => (
          <button key={value} type="button" role="tab" id={`aware-tab-${value}`} aria-selected={tab === value} aria-controls={`aware-panel-${value}`}
            className={tab === value ? 'is-active' : ''} onClick={() => control.setTab(value)}>
            {value === 'inbox' ? 'Inbox' : value === 'attention' ? 'Attention' : 'Activity'}
            {counts[value] > 0 && <span className={value === 'attention' ? 'aware-count is-hot' : 'aware-count'}>{counts[value] > 99 ? '99+' : counts[value]}</span>}
          </button>
        ))}
      </div>
      <div className="aware-panel" role="tabpanel" id={`aware-panel-${tab}`} aria-labelledby={`aware-tab-${tab}`}>
        {tab === 'inbox' && <InboxTab quest={quest} control={control} inbox={inbox} onOpenTask={id => go(() => onOpenTask(id))} onOpenThread={onOpenThread} onOpenItem={onOpenItem} onOpenLead={id => go(() => onOpenLead(id))} onOpenInbox={() => go(onOpenInbox)} />}
        {tab === 'attention' && <AttentionTab quest={quest} control={control} attention={attention} onOpenTask={id => go(() => onOpenTask(id))} onOpenLead={id => go(() => onOpenLead(id))} onOpenAll={() => go(onOpenAttention)} />}
        {tab === 'activity' && <ActivityTab quest={quest} onOpenTask={id => go(() => onOpenTask(id))} onOpenAll={() => go(onOpenActivity)} />}
      </div>
      <p className="aware-foot">{quest.backend.kind === 'live' ? 'Updates as the workspace changes.' : 'Demo · changes on this device update here instantly.'}</p>
      {state.people.find(item => item.id === quest.actor)?.role === 'reviewer' && <p className="aware-foot">Reviewer view: no actions.</p>}
    </section>
  );
}

function InboxTab({ quest, control, inbox, onOpenTask, onOpenThread, onOpenItem, onOpenLead, onOpenInbox }: { quest: Quest; control: SidebarControl; inbox: UniversalInbox; onOpenTask: (id: string) => void; onOpenThread?: (id: string) => void; onOpenItem?: (item: InboxItem) => void; onOpenLead: (id: string) => void; onOpenInbox: () => void }) {
  const { state, now } = quest;
  const [all, setAll] = useState(false);
  const read = control.read;
  const items = all ? inbox.items : inbox.items.slice(0, SHOWN);
  return (
    <>
      <div className="aware-head">
        <span><b>{inbox.unread}</b> unread · {inbox.items.length} total</span>
        <span>
          <button type="button" className="link" disabled={!inbox.unread} onClick={() => control.markRead(inbox.items.map(item => item.id))}>Mark all read</button>
          <button type="button" className="link" onClick={onOpenInbox}>Open inbox</button>
        </span>
      </div>
      {!inbox.items.length && <p className="aware-empty">Nothing is addressed to you.</p>}
      <ul className="aware-list">
        {items.map(item => {
          const unread = !read.has(item.id);
          const open = () => { control.markRead([item.id]); if (onOpenItem) { onOpenItem(item); return; } if (item.channelId) onOpenInbox(); else if (item.taskId) (onOpenThread ?? onOpenTask)(item.taskId); else if (item.leadId) onOpenLead(item.leadId); else onOpenInbox(); };
          return (
            <li key={item.id} className={`aware-row has-check ${unread ? 'is-unread' : ''} ${item.urgent ? 'is-urgent' : ''}`}>
              <button type="button" className="aware-main" onClick={open}>
                <span className="aware-kind">{unread && <i className="aware-dot" aria-label="Unread" />}<b>{item.kind === 'mention' ? 'Mention' : item.kind === 'message' ? 'Message' : 'Task'}</b><em>{item.workspace.name}</em><time>{ago(item.at, now)}</time></span>
                <span className="aware-title">{item.title}</span>
                <span className="aware-detail">{item.from ? `${firstName(state, item.from) || item.from}: ` : ''}{item.detail}</span>
              </button>
              {unread && (
                <button type="button" className="aware-check" aria-label={`Mark read: ${item.title}`} title="Mark read" onClick={() => control.markRead([item.id])}>
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {inbox.items.length > SHOWN && <button type="button" className="aware-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${inbox.items.length - SHOWN} more`}</button>}
    </>
  );
}

function AttentionTab({ quest, control, attention, onOpenTask, onOpenLead, onOpenAll }: { quest: Quest; control: SidebarControl; attention: Attention; onOpenTask: (id: string) => void; onOpenLead: (id: string) => void; onOpenAll: () => void }) {
  const [all, setAll] = useState(false);
  const items = all ? attention.items : attention.items.slice(0, SHOWN);
  return (
    <>
      <div className="aware-head">
        <span><b>{attention.mine}</b> for you · {attention.items.length} open{attention.snoozed ? ` · ${attention.snoozed} snoozed` : ''}</span>
        <button type="button" className="link" onClick={onOpenAll}>Needs Attention</button>
      </div>
      {!attention.items.length && <p className="aware-empty">Nothing is wrong right now.</p>}
      <ul className="aware-list">
        {items.map(item => <AttentionRow key={item.id} quest={quest} control={control} item={item} onOpenTask={onOpenTask} onOpenLead={onOpenLead} />)}
      </ul>
      {attention.items.length > SHOWN && <button type="button" className="aware-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${attention.items.length - SHOWN} more`}</button>}
      <p className="aware-note">Items leave when the problem is fixed. Reading doesn’t clear them.</p>
    </>
  );
}

function AttentionRow({ quest, control, item, onOpenTask, onOpenLead }: { quest: Quest; control: SidebarControl; item: AttentionItem; onOpenTask: (id: string) => void; onOpenLead: (id: string) => void }) {
  const { state, dispatch } = quest;
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(false);
  const task = item.taskId ? taskById(state, item.taskId) : undefined;
  const open = () => { if (item.taskId) onOpenTask(item.taskId); else if (item.leadId) onOpenLead(item.leadId); };
  return (
    <li className={`aware-row sev-${item.severity}`}>
      <button type="button" className="aware-main" onClick={open} disabled={!item.taskId && !item.leadId}>
        <span className="aware-kind"><b>{INSIGHT_LABELS[item.kind]}</b>{task && <em>{task.title}</em>}</span>
        <span className="aware-title">{item.what}</span>
        <span className="aware-detail">Next: {item.next}</span>
      </button>
      <div className="aware-actions">
        <span className="aware-who"><Avatar state={state} id={item.who} size="sm" />{item.mine ? 'You act next' : item.who ? `${firstName(state, item.who)} acts next` : 'The team'}</span>
        {item.quick && <button type="button" className="aware-act is-primary" disabled={busy} onClick={async () => { setBusy(true); await dispatch(item.quick!.do); setBusy(false); }}>{item.quick.label}</button>}
        <button type="button" className="aware-act" aria-expanded={why} onClick={() => setWhy(!why)}>Why</button>
        {item.snoozable && <button type="button" className="aware-act" title="Hide on this device until tomorrow morning" onClick={() => control.snooze(item.id, tomorrowMorning())}>Snooze</button>}
      </div>
      {why && <p className="aware-why">{item.why}</p>}
    </li>
  );
}

function ActivityTab({ quest, onOpenTask, onOpenAll }: { quest: Quest; onOpenTask: (id: string) => void; onOpenAll: () => void }) {
  const { state, actor, now } = quest;
  const [mineOnly, setMineOnly] = useState(false);
  const [all, setAll] = useState(false);
  const feed = activityFor(state, actor, 60).filter(item => !mineOnly || item.mine);
  const items = all ? feed : feed.slice(0, SHOWN + 4);
  return (
    <>
      <div className="aware-head">
        <div className="segmented" role="group" aria-label="Whose activity">
          <button type="button" className={!mineOnly ? 'is-on' : ''} aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>Everyone</button>
          <button type="button" className={mineOnly ? 'is-on' : ''} aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>Mine</button>
        </div>
        <button type="button" className="link" onClick={onOpenAll}>Full history</button>
      </div>
      {!feed.length && <p className="aware-empty">No changes yet.</p>}
      <ol className="aware-list is-activity">
        {items.map(({ event }) => (
          <li key={event.id} className={`aware-event ${event.undone ? 'is-undone' : ''}`}>
            <time>{ago(event.at, now)}</time>
            <div>
              {event.taskId ? <button type="button" className="aware-event-text" onClick={() => onOpenTask(event.taskId!)}>{event.text}</button> : <span className="aware-event-text">{event.text}</span>}
              {event.undone && <em className="aware-tag">Undone</em>}
              {event.effects?.map((effect, index) => (
                <span key={index} className={`aware-effect is-${effect.outcome}`}>
                  {effect.outcome === 'executed' ? '↳ ' : '↳ skipped: '}
                  {effect.rule === 'dependency-unlock' ? 'unlocked' : effect.rule === 'handoff' ? 'handed off' : 'released focus on'} “{taskById(state, effect.taskId)?.title ?? 'a task'}”
                  {effect.owner ? ` → ${firstName(state, effect.owner)}` : ''}{effect.reason ? ` (${effect.reason})` : ''}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {feed.length > items.length && <button type="button" className="aware-more" onClick={() => setAll(true)}>Show {feed.length - items.length} more</button>}
    </>
  );
}

function ago(at: number, now: number) {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${clock(at)}`;
}

function tomorrowMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(8, 0, 0, 0);
  return date.getTime();
}
