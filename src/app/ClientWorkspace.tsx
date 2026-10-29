// The client's shared workspace: one project, read from the team's own records (see
// core/client-portal.ts), with New Quest as the way to reach the team. No internal navigation,
// search, assistant or task tools are rendered here; the client sees only the projection.
// Demo only for now: live Task HQ has no client grants or server-side projection yet.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { CLIENT_INPUT_TAG, CLIENT_SHARE_TAG, DEMO_CLIENT, DEMO_CLIENT_TEAM, authorize, clientWorkspace, ensureClientSpace, submitQuest } from '../core/client-portal.ts';
import type { ClientAccess, ClientUpdate, UpdateKind } from '../core/client-portal.ts';
import { ago } from '../core/dashboard.ts';
import { postMessage, QUEST_KIND_LABELS } from '../core/inbox.ts';
import type { MessageAttachment, MessagingState, QuestKind } from '../core/inbox.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { localDate, shortDate } from '../core/time.ts';
import { demoMessaging } from '../adapter/messaging.ts';
import { deviceMediaStore } from '../adapter/media.ts';
import { BrandMark, CtaArrow } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import '../ui/client.css';

/** The demo's client grants. Live grants would come from the server, never from the browser. */
const DEMO_GRANTS: ClientAccess[] = [DEMO_CLIENT];
const MAX_FILE = 20 * 1024 * 1024;
const FILE_ICON = 'M14 3H6v18h12V7zM14 3v4h4';

const KIND_ICON: Record<UpdateKind, string> = {
  planned: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4', started: 'M5 12h14M13 6l6 6-6 6', review: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  completed: 'M5 12l5 5L20 7', reopened: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4', message: 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z', you: 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z',
};
const QUEST_HINTS: { kind: QuestKind; label: string; hint: string; icon: string }[] = [
  { kind: 'question', label: 'Ask a question', hint: '“Can you confirm the start date?”', icon: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 18h.01' },
  { kind: 'update', label: 'Share an update', hint: 'Something the team should know.', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
  { kind: 'document', label: 'Share a document', hint: 'Upload permits, photos or paperwork.', icon: 'M14 3H6v18h12V7zM14 3v4h4' },
  { kind: 'issue', label: 'Report an issue', hint: 'Let us know about something on site.', icon: 'M12 3 2 21h20zM12 10v5M12 18h.01' },
  { kind: 'help', label: 'Request a next step', hint: 'Ask for help or what happens next.', icon: 'M5 12h14M13 6l6 6-6 6' },
];
const Icon = ({ d, className = 'icon' }: { d: string; className?: string }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function ClientWorkspace({ quest, onExit, projectId = DEMO_CLIENT.projectId }: { quest: Quest; onExit: () => void; projectId?: string }) {
  const { state, now } = quest;
  const auth = authorize(DEMO_GRANTS, DEMO_CLIENT.person, projectId);
  const store = useMemo(() => demoMessaging(state.people), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [messaging, setMessaging] = useState<MessagingState>(() => store.load());
  useEffect(() => store.subscribe(setMessaging), [store]);
  // Older demo stores predate the client channel; add it once.
  useEffect(() => {
    const ensured = ensureClientSpace(messaging, DEMO_CLIENT, DEMO_CLIENT_TEAM, Date.now());
    if (ensured !== messaging) store.save(ensured);
  }, [messaging, store]);
  // Demo setup: a demo saved before client sharing has no tagged tasks. Share three as the manager would (a real, visible task edit).
  const shared = useRef(false);
  useEffect(() => {
    if (shared.current || state.tasks.some(task => task.projectId === DEMO_CLIENT.projectId && task.tags?.includes(CLIENT_SHARE_TAG))) return;
    shared.current = true;
    const share = [['site-plan', [CLIENT_SHARE_TAG]], ['staging-area', [CLIENT_SHARE_TAG, CLIENT_INPUT_TAG]], ['permit-update', [CLIENT_SHARE_TAG]]] as const;
    void (async () => { for (const [id, tags] of share) { const task = state.tasks.find(item => item.id === id); if (task) await quest.backend.dispatch({ type: 'task/update', id, changes: { tags: [...new Set([...(task.tags ?? []), ...tags])] } }, 'jordan'); } })();
  }, [state.tasks, quest.backend]);

  if (!auth.ok) return <div className="cp cp-denied"><BrandMark size={36} /><h1>No access</h1><p>{auth.error}</p><button type="button" className="btn" onClick={onExit}>Back</button></div>;
  return <ClientPage quest={quest} access={auth.access} messaging={messaging} onMessaging={next => { store.save(next); setMessaging(next); }} onExit={onExit} now={now} />;
}

function ClientPage({ quest, access, messaging, onMessaging, onExit, now }: {
  quest: Quest; access: ClientAccess; messaging: MessagingState; onMessaging: (next: MessagingState) => void; onExit: () => void; now: number;
}) {
  const view = useMemo(() => clientWorkspace(quest.state, messaging, access), [quest.state, messaging, access]);
  const today = localDate(now);
  const [filter, setFilter] = useState<'all' | 'progress' | 'messages'>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [composer, setComposer] = useState<QuestKind | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [bell, setBell] = useState(false);
  const discussion = useRef<HTMLTextAreaElement>(null);
  const updates = view.updates.filter(item => filter === 'all' || (filter === 'messages' ? item.kind === 'message' || item.kind === 'you' : item.taskId));
  const r = 30, circumference = 2 * Math.PI * r;
  const company = messaging.workspaces.find(item => item.id === access.workspaceId)?.name ?? quest.state.workspace.name;

  return (
    <div className="cp">
      <aside className="cp-rail" aria-label="Client workspace">
        <span className="cp-brand"><BrandMark size={30} /></span>
        <a className="cp-rail-item is-on" href="#/client" aria-current="page" aria-label={`${view.project.name} home`} title="Project home"><Icon d="M3 11 12 4l9 7v9H3z M9 20v-6h6v6" /></a>
      </aside>

      <header className="cp-top">
        <span className="cp-project-mark" aria-hidden="true">{view.project.name[0]}</span>
        <span className="cp-project"><strong>{view.project.name}</strong><small>{company}</small></span>
        <span className="cp-status"><i aria-hidden="true" />Active</span>
        <span className="cp-top-end">
          <button type="button" className="icon-btn cp-bell" aria-expanded={bell} aria-label={`Notifications: ${view.input.length} waiting on you`} onClick={() => setBell(open => !open)}>
            <Icon d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4" />{view.input.length > 0 && <b>{view.input.length}</b>}
          </button>
          {bell && <div className="cp-pop" role="dialog" aria-label="Notifications">
            <p className="cp-label">Waiting on you</p>
            {view.input.length === 0 ? <p className="cp-quiet">Nothing needs you right now.</p> : <ul>{view.input.map(item => <li key={item.id}><b>{item.title}</b><small>{item.detail}</small></li>)}</ul>}
          </div>}
        </span>
      </header>

      <div className="cp-demo" role="note"><span><b>Client preview</b> · synthetic data · what {access.name} sees for one project</span><button type="button" className="link" onClick={onExit}>Back to team view</button></div>

      <main className="cp-main">
        <div className="cp-head">
          <div><h1>{view.project.name}</h1><p>Project updates, decisions, and next steps for your project.</p></div>
          <button type="button" className="btn btn-primary cp-new-head" onClick={() => setComposer('question')}>+ New Quest</button>
        </div>

        <div className="cp-grid">
          <section className="cp-card cp-updates" aria-labelledby="cp-updates-title">
            <header className="cp-card-head">
              <h2 id="cp-updates-title">Project updates</h2>
              <label className="cp-filter"><span className="sr-only">Show</span>
                <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All updates</option><option value="progress">Progress</option><option value="messages">Messages</option></select>
              </label>
            </header>
            {updates.length === 0 ? <p className="cp-quiet">No updates yet. Your team’s progress will appear here.</p> : <ul className="cp-feed">
              {updates.slice(0, 12).map(item => <UpdateRow key={item.id} item={item} now={now} today={today} open={picked === item.id} view={view}
                onToggle={() => setPicked(picked === item.id ? null : item.id)} onReply={() => discussion.current?.focus()} />)}
            </ul>}
          </section>

          <div className="cp-side">
            <section className="cp-card cp-progress" aria-label="Project progress">
              <span className="cp-ring" aria-hidden="true"><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r={r} className="cp-ring-track" />
                {view.progress.percent > 0 && <circle cx="36" cy="36" r={r} className="cp-ring-value" strokeDasharray={`${(view.progress.percent / 100) * circumference} ${circumference}`} transform="rotate(-90 36 36)" />}</svg><b>{view.progress.percent}%</b></span>
              <span className="cp-progress-text"><strong>Project progress</strong><small>{view.progress.done} of {view.progress.total} shared tasks complete</small></span>
              <button type="button" className="btn btn-primary cta-fill cp-new" onClick={() => setComposer('question')}><span className="cta-fill-label">New Quest</span><CtaArrow /></button>
            </section>

            <section className="cp-card" aria-labelledby="cp-next-title">
              <header className="cp-card-head"><h2 id="cp-next-title">What’s next</h2></header>
              {view.next.length === 0 ? <p className="cp-quiet">Nothing scheduled yet.</p> : <ul className="cp-rows">
                {view.next.map(task => <li key={task.id}><span className="cp-row-icon"><Icon d={KIND_ICON.planned} /></span><span><b>{task.title}</b><small>{STATUS_LABELS[task.status]}</small></span><time className={task.due === today ? 'is-today' : ''}>{task.due ? (task.due === today ? 'Today' : shortDate(task.due, today)) : '—'}</time></li>)}
              </ul>}
            </section>

            <section className="cp-card" aria-labelledby="cp-input-title">
              <header className="cp-card-head"><h2 id="cp-input-title">Needs your input</h2>{view.input.length > 0 && <span className="cp-count">{view.input.length}</span>}</header>
              {view.input.length === 0 ? <p className="cp-quiet">Nothing is waiting on you.</p> : <ul className="cp-rows">
                {view.input.map(item => <li key={item.id} className="is-input"><span className="cp-row-icon"><Icon d={KIND_ICON.message} /></span><span><b>{item.title}</b><small>{item.detail}</small></span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setComposer(item.messageId ? 'question' : 'update')}>Respond</button></li>)}
              </ul>}
            </section>

            <section className="cp-card" aria-labelledby="cp-files-title">
              <header className="cp-card-head"><h2 id="cp-files-title">Shared files</h2></header>
              {view.files.length === 0 ? <p className="cp-quiet">No files yet. Files you or the team share appear here.</p> : <ul className="cp-rows">
                {view.files.slice(0, 6).map(file => <li key={file.attachment.id}><span className="cp-row-icon"><Icon d={FILE_ICON} /></span><span><b>{file.attachment.name}</b><small>{size(file.attachment.bytes)} · {file.by} · {ago(file.at, now)}</small></span><FileLink attachment={file.attachment} /></li>)}
              </ul>}
            </section>
          </div>
        </div>

        <Discussion view={view} now={now} inputRef={discussion} onSend={text => {
          const result = postMessage(messaging, access.person, access.channelId, text, Date.now(), `cm-${Date.now()}`, { externalTaxonomy: true });
          if (!result.ok) return result.error;
          onMessaging(result.state);
          return null;
        }} />
      </main>

      {composer && <NewQuest initial={composer} project={view.project.name} onClose={() => setComposer(null)} onSubmit={(kind, text, attachments) => {
        const result = submitQuest(messaging, access, { kind, text, attachments }, Date.now(), `quest-${Date.now()}`);
        if (!result.ok) return result.error;
        onMessaging(result.state);
        setComposer(null);
        setSent(`${QUEST_KIND_LABELS[kind]} sent to your ${view.project.name} team. They’ll reply here.`);
        return null;
      }} />}
      {sent && <div className="cp-toast" role="status"><Icon d={KIND_ICON.completed} />{sent}<button type="button" className="link" onClick={() => setSent(null)}>Dismiss</button></div>}
    </div>
  );
}

function UpdateRow({ item, now, today, open, view, onToggle, onReply }: {
  item: ClientUpdate; now: number; today: string; open: boolean; view: ReturnType<typeof clientWorkspace>; onToggle: () => void; onReply: () => void;
}) {
  const task = item.taskId ? view.tasks.find(entry => entry.id === item.taskId) : undefined;
  const message = item.messageId ? view.conversation.find(entry => entry.id === item.messageId) : undefined;
  const around = message ? view.conversation.filter(entry => Math.abs(entry.at - message.at) < 2 * 86_400_000 && entry.id !== message.id).slice(-3) : view.conversation.slice(-2);
  return <li className={`cp-update k-${item.kind} ${open ? 'is-open' : ''}`}>
    <button type="button" className="cp-update-main" aria-expanded={open} onClick={onToggle}>
      <span className="cp-update-icon"><Icon d={KIND_ICON[item.kind]} /></span>
      <span className="cp-update-text"><b>{item.title}</b><span>{item.detail}</span>{item.files > 0 && <small>{item.files} file{item.files === 1 ? '' : 's'} attached</small>}</span>
      <span className="cp-update-meta"><time>{ago(item.at, now)}</time><small>{item.by}</small></span>
    </button>
    {open && <div className="cp-update-detail">
      {task && <dl><div><dt>Status</dt><dd>{STATUS_LABELS[task.status]}</dd></div><div><dt>Due</dt><dd>{task.due ? shortDate(task.due, today) : 'Not scheduled'}</dd></div></dl>}
      {message?.attachments.length ? <ul className="cp-files-inline">{message.attachments.map(file => <li key={file.id}>{file.name} <small>{size(file.bytes)}</small> <FileLink attachment={file} /></li>)}</ul> : null}
      {around.length > 0 && <div className="cp-context"><p className="cp-label">Conversation</p>{around.map(entry => <p key={entry.id}><b>{entry.by}</b> {entry.text}</p>)}</div>}
      <button type="button" className="link" onClick={onReply}>Reply in the discussion</button>
    </div>}
  </li>;
}

function Discussion({ view, now, inputRef, onSend }: { view: ReturnType<typeof clientWorkspace>; now: number; inputRef: RefObject<HTMLTextAreaElement | null>; onSend: (text: string) => string | null }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); const failed = onSend(text); if (failed) setError(failed); else { setText(''); setError(''); } };
  return <section className="cp-card cp-discussion" aria-labelledby="cp-disc-title">
    <header className="cp-card-head"><h2 id="cp-disc-title">Recent discussion</h2></header>
    {view.conversation.length === 0 ? <p className="cp-quiet">No messages yet.</p> : <ul className="cp-msgs">
      {view.conversation.slice(-6).map(item => <li key={item.id} className={item.mine ? 'is-mine' : ''}>
        <span className="cp-avatar" aria-hidden="true">{item.by[0]}</span>
        <span><b>{item.by}</b> <time>{ago(item.at, now)}</time>{item.quest && <em className="cp-quest-tag">New Quest · {QUEST_KIND_LABELS[item.quest]}</em>}<p>{item.text}</p>
          {item.attachments.length > 0 && <small>{item.attachments.map(file => file.name).join(', ')}</small>}</span>
      </li>)}
    </ul>}
    <form className="cp-reply" onSubmit={submit}>
      <label className="sr-only" htmlFor="cp-reply-text">Message your team</label>
      <textarea id="cp-reply-text" ref={inputRef} rows={1} value={text} placeholder="Write a message or ask a question…" onChange={event => setText(event.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Send</button>
      {error && <p className="cp-error" role="alert">{error}</p>}
    </form>
  </section>;
}

function NewQuest({ initial, project, onClose, onSubmit }: { initial: QuestKind; project: string; onClose: () => void; onSubmit: (kind: QuestKind, text: string, attachments: MessageAttachment[]) => string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<QuestKind>(initial);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() && files.length === 0) { setError('Write a message or attach a file.'); return; }
    const big = files.find(file => file.size > MAX_FILE);
    if (big) { setError(`${big.name} is over 20 MB.`); return; }
    setBusy(true);
    try {
      const attachments: MessageAttachment[] = [];
      for (const file of files) attachments.push({ id: `att-${Date.now()}-${attachments.length}`, name: file.name, mime: file.type || 'application/octet-stream', bytes: file.size, mediaId: await deviceMediaStore.put(file) });
      const failed = onSubmit(kind, text, attachments);
      if (failed) setError(failed);
    } catch { setError('Files couldn’t be saved in this browser. Try again without them.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="cp-quest" aria-labelledby="cp-quest-title" onClose={onClose} onCancel={onClose}>
    <form onSubmit={submit}>
      <header><h2 id="cp-quest-title">New Quest</h2><p>Share a question, update, or request with your {project} team.</p>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon d="M6 6l12 12M18 6 6 18" /></button></header>
      <div className="cp-quest-body">
        <div className="cp-quest-main">
          <label className="sr-only" htmlFor="cp-quest-text">Your message</label>
          <textarea id="cp-quest-text" autoFocus rows={6} maxLength={2000} value={text} placeholder="Type your message, question, or request…" onChange={event => setText(event.target.value)} />
          <div className="cp-quest-files">
            <label className="btn btn-ghost btn-sm"><Icon d="M21 12.5 12.6 21a5 5 0 0 1-7.1-7.1L14 5.4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.6 8" />Attach files
              <input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip" className="sr-only" onChange={event => setFiles(current => [...current, ...Array.from(event.target.files ?? [])].slice(0, 10))} /></label>
            {files.map((file, at) => <span key={`${file.name}-${at}`} className="cp-chip">{file.name} <small>{size(file.size)}</small><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, index) => index !== at))}>×</button></span>)}
          </div>
          {error && <p className="cp-error" role="alert">{error}</p>}
          <p className="cp-quiet cp-quest-note">This goes to the team’s inbox as a message. They’ll decide whether it becomes a task and reply here.</p>
        </div>
        <fieldset className="cp-quest-kinds">
          <legend>What is this?</legend>
          {QUEST_HINTS.map(item => <label key={item.kind} className={kind === item.kind ? 'is-on' : ''}>
            <input type="radio" name="cp-kind" value={item.kind} checked={kind === item.kind} onChange={() => setKind(item.kind)} />
            <span className="cp-row-icon"><Icon d={item.icon} /></span><span><b>{item.label}</b><small>{item.hint}</small></span>
          </label>)}
        </fieldset>
      </div>
      <footer><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></footer>
    </form>
  </dialog>;
}

function FileLink({ attachment }: { attachment: MessageAttachment }) {
  const open = async () => {
    const blob = await deviceMediaStore.get(attachment.mediaId).catch(() => null);
    if (!blob) { window.alert('This file is stored on the device that sent it (demo).'); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = attachment.name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return <button type="button" className="icon-btn cp-download" aria-label={`Download ${attachment.name}`} onClick={open}><Icon d="M12 4v11M7 10l5 5 5-5M5 20h14" /></button>;
}
