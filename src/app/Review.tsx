import { Select } from '../ui/Select.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
// Collaborative review layer: launcher, review drawer, Feedback inbox, invitation
// drafts and the reviewer welcome. All changes go through the Quest engine
// (feedback/* and invite/* actions); captures go to the private media store.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Action, FeedbackCategory, FeedbackItem, FeedbackStatus } from '../core/contract.ts';
import { APP_VERSION, FEEDBACK_CATEGORY_LABELS, FEEDBACK_STATUS_LABELS, REVIEWER_SCOPE } from '../core/contract.ts';
import { apply } from '../core/engine.ts';
import { leadById, nameOf, person, taskById } from '../core/selectors.ts';
import { clock, duration } from '../core/time.ts';
import { deviceMediaStore } from '../adapter/media.ts';
import { Avatar } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { RECORDING_LIMIT_MS, captureScreenshot, startRecording } from './capture.ts';
import type { Recording } from './capture.ts';

export interface ScreenContext { view: string; route: string; taskId: string; leadId: string; deck: string }

interface DraftCapture { key: number; kind: 'screenshot' | 'recording'; blob: Blob; url: string; durationMs: number; annotated: boolean; consentAt: number }

const CATEGORIES = Object.keys(FEEDBACK_CATEGORY_LABELS) as FeedbackCategory[];
const STATUSES = Object.keys(FEEDBACK_STATUS_LABELS) as FeedbackStatus[];

/** Would the engine accept this right now? (Dry run, nothing is written.) */
function allowed(quest: Quest, action: Action) {
  return apply(quest.state, action, { actor: quest.actor, now: quest.now, newId: () => 'dry-run' }).ok;
}

const viewport = () => `${window.innerWidth}x${window.innerHeight}`;

// ── Launcher + drawer ──────────────────────────────────────────────────────

export function ReviewLayer({ quest, screen, itemId, onItem, onNavigate, openRequest = 0 }: {
  quest: Quest; screen: ScreenContext; openRequest?: number; itemId: string | null; onItem: (id: string | null) => void;
  onNavigate: (target: { taskId?: string; leadId?: string; route?: string }) => void;
}) {
  const { state, actor, dispatch } = quest;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'new' | 'here' | 'mine'>('new');
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [captures, setCaptures] = useState<DraftCapture[]>([]);
  const [annotating, setAnnotating] = useState<DraftCapture | null>(null);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(0);

  useEffect(() => { if (itemId) setOpen(true); }, [itemId]);
  useEffect(() => { if (openRequest) { setOpen(true); setTab('new'); } }, [openRequest]);
  useEffect(() => () => captures.forEach(item => URL.revokeObjectURL(item.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const here = state.feedback.filter(item => (screen.taskId && item.context.taskId === screen.taskId) || (screen.leadId && item.context.leadId === screen.leadId) || (!screen.taskId && !screen.leadId && item.context.view === screen.view));
  const mine = state.feedback.filter(item => item.author === actor);
  const openCount = state.feedback.filter(item => item.status !== 'resolved').length;
  const item = itemId ? state.feedback.find(entry => entry.id === itemId) : undefined;

  function close() { setOpen(false); onItem(null); setError(''); }

  async function screenshot() {
    setError('');
    setOpen(false); // keep the drawer out of the shot
    await new Promise(resolve => setTimeout(resolve, 250));
    try {
      const consentAt = Date.now();
      const blob = await captureScreenshot();
      keyRef.current += 1;
      setAnnotating({ key: keyRef.current, kind: 'screenshot', blob, url: URL.createObjectURL(blob), durationMs: 0, annotated: false, consentAt });
    } catch (reason) {
      setError(reason instanceof Error && reason.name === 'NotAllowedError' ? 'Screenshot cancelled.' : `Screenshot failed: ${reason instanceof Error ? reason.message : 'unknown error'}`);
    }
    setOpen(true);
  }

  async function record() {
    setError('');
    setConsent(false);
    setOpen(false);
    try {
      const consentAt = Date.now();
      const active = await startRecording();
      setRecording(active);
      const { blob, durationMs } = await active.done;
      keyRef.current += 1;
      setCaptures(current => [...current, { key: keyRef.current, kind: 'recording', blob, url: URL.createObjectURL(blob), durationMs, annotated: false, consentAt }]);
    } catch (reason) {
      setError(reason instanceof Error && reason.name === 'NotAllowedError' ? 'Recording cancelled.' : `Recording failed: ${reason instanceof Error ? reason.message : 'unknown error'}`);
    }
    setRecording(null);
    setTab('new');
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const created = await dispatch({ type: 'feedback/create', item: { category, title, body, context: { ...screen, version: APP_VERSION, viewport: viewport() } } });
    if (!created.ok) { setBusy(false); return; }
    const id = created.state.feedback[0]!.id;
    for (const capture of captures) {
      try {
        const mediaId = await deviceMediaStore.put(capture.blob);
        const result = await dispatch({ type: 'feedback/attach', id, attachment: { kind: capture.kind, mediaId, mime: capture.blob.type || (capture.kind === 'screenshot' ? 'image/png' : 'video/webm'), bytes: capture.blob.size, durationMs: capture.durationMs, annotated: capture.annotated, consentBy: actor, consentAt: capture.consentAt } });
        if (!result.ok) await deviceMediaStore.remove(mediaId);
      } catch { setError('A capture could not be stored on this device; the written feedback was saved.'); }
    }
    captures.forEach(capture => URL.revokeObjectURL(capture.url));
    setCaptures([]); setTitle(''); setBody(''); setCategory('idea'); setBusy(false);
    onItem(id);
  }

  return (
    <>
      {recording && <RecordingPill recording={recording} now={quest.now} />}
      {!open && !recording && (
        <button type="button" className="review-launcher" onClick={() => { setOpen(true); setTab('new'); }} aria-label={`Feedback${openCount ? `, ${openCount} open` : ''}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg><span>Feedback</span>{openCount > 0 && <b>{openCount}</b>}
        </button>
      )}
      {open && (
        <>
          <button className="scrim" aria-label="Close feedback" onClick={close} />
          <aside className="drawer review-drawer" role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (annotating) setAnnotating(null); else if (consent) setConsent(false); else close(); } }}>
            <header className="drawer-head">
              <strong id="review-title">{item ? 'Feedback thread' : 'Feedback'}</strong>
              <span className="review-where">{screen.view}{screen.taskId ? ` · ${taskById(state, screen.taskId)?.title ?? 'task'}` : ''}{screen.leadId ? ` · ${leadById(state, screen.leadId)?.name ?? 'lead'}` : ''}</span>
              <button type="button" className="icon-btn" aria-label="Close" onClick={close}>×</button>
            </header>
            <div className="drawer-body">
              {item ? (
                <>
                  <button type="button" className="link" onClick={() => onItem(null)}>← All feedback</button>
                  <FeedbackThread quest={quest} item={item} onNavigate={target => { close(); onNavigate(target); }} />
                </>
              ) : annotating ? (
                <Annotator capture={annotating} onDone={(blob, annotated) => { URL.revokeObjectURL(annotating.url); setCaptures(current => [...current, { ...annotating, blob, url: URL.createObjectURL(blob), annotated }]); setAnnotating(null); }} onCancel={() => { URL.revokeObjectURL(annotating.url); setAnnotating(null); }} />
              ) : consent ? (
                <div className="consent">
                  <h3>Record your screen for this feedback?</h3>
                  <ul>
                    <li>Chrome will ask what to share. Choose the <b>Task-HQ tab</b>.</li>
                    <li>No audio. Recording stops when you press Stop, use Chrome’s “Stop sharing”, or after {duration(RECORDING_LIMIT_MS)}.</li>
                    <li>The video stays in this browser’s private storage and is attached only to this feedback.</li>
                  </ul>
                  <div className="preview-actions"><button type="button" className="btn btn-ghost" onClick={() => setConsent(false)}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => void record()}>I agree — start recording</button></div>
                </div>
              ) : (
                <>
                  <div className="seg review-tabs" role="tablist">
                    <button type="button" role="tab" aria-pressed={tab === 'new'} onClick={() => setTab('new')}>New</button>
                    <button type="button" role="tab" aria-pressed={tab === 'here'} onClick={() => setTab('here')}>This screen <span>{here.length}</span></button>
                    <button type="button" role="tab" aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>Mine <span>{mine.length}</span></button>
                  </div>
                  {tab === 'new' ? (
                    <form className="form review-form" onSubmit={submit}>
                      <div className="seg" role="group" aria-label="Category">{CATEGORIES.map(value => <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>{FEEDBACK_CATEGORY_LABELS[value]}</button>)}</div>
                      <label className="field"><span>Short title</span><input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Handoff animation is too fast" /></label>
                      <label className="field"><span>Details (optional)</span><ReferenceTextarea rows={4} maxLength={4000} value={body} onChange={event => setBody(event.target.value)} placeholder="What did you expect? What happened?" /></label>
                      <div className="capture-row">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void screenshot()}>Capture screenshot</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConsent(true)}>Record screen…</button>
                        {captures.map(capture => (
                          <span key={capture.key} className="capture-chip">{capture.kind === 'screenshot' ? <img src={capture.url} alt="Screenshot to attach" /> : <span>▶ {duration(capture.durationMs)}</span>}
                            <button type="button" aria-label="Remove capture" onClick={() => { URL.revokeObjectURL(capture.url); setCaptures(current => current.filter(entry => entry.key !== capture.key)); }}>×</button></span>
                        ))}
                      </div>
                      <p className="muted">Attached automatically: screen “{screen.view}”{screen.taskId ? ', the open task' : ''}{screen.leadId ? ', the selected lead' : ''}, app version {APP_VERSION}, window size. Nothing else is collected.</p>
                      <button className="btn btn-primary" disabled={!title.trim() || busy}>{busy ? 'Saving…' : 'Save feedback'}</button>
                    </form>
                  ) : (
                    <FeedbackList quest={quest} items={tab === 'here' ? here : mine} onOpen={onItem} empty={tab === 'here' ? 'No feedback on this screen yet.' : 'You haven’t left feedback yet.'} />
                  )}
                  {error && <p className="deck-feedback f-error" role="status">{error}</p>}
                  <p className="boundary">{quest.backend.kind === 'live' ? `Written feedback is shared with ${quest.state.workspace.name}. Screenshots and recordings stay on this device for now.` : 'Stored on this device only. It isn’t shared with anyone until a Task-HQ backend is connected.'}</p>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function RecordingPill({ recording, now }: { recording: Recording; now: number }) {
  return (
    <div className="recording-pill" role="status">
      <span className="rec-dot" aria-hidden="true" />Recording {duration(now - recording.startedAt)} / {duration(RECORDING_LIMIT_MS)}
      <button type="button" className="btn btn-sm btn-dark" onClick={recording.stop}>Stop</button>
    </div>
  );
}

// ── Annotator: pen and box on the captured screenshot ─────────────────────

function Annotator({ capture, onDone, onCancel }: { capture: DraftCapture; onDone: (blob: Blob, annotated: boolean) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<'pen' | 'box'>('box');
  const [marks, setMarks] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const snapshot = useRef<ImageData | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      image.current = img;
      const c = canvas.current!;
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
    };
    img.src = capture.url;
  }, [capture.url]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * event.currentTarget.width, y: ((event.clientY - box.top) / box.height) * event.currentTarget.height };
  };
  const ctx = () => {
    const c = canvas.current!.getContext('2d')!;
    c.strokeStyle = '#e8590c'; c.lineWidth = Math.max(4, canvas.current!.width / 250); c.lineCap = 'round'; c.lineJoin = 'round';
    return c;
  };
  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = point(event);
    snapshot.current = ctx().getImageData(0, 0, canvas.current!.width, canvas.current!.height);
    if (tool === 'pen') { const c = ctx(); c.beginPath(); c.moveTo(start.current.x, start.current.y); }
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!start.current) return;
    const p = point(event);
    const c = ctx();
    if (tool === 'pen') { c.lineTo(p.x, p.y); c.stroke(); return; }
    c.putImageData(snapshot.current!, 0, 0);
    c.strokeRect(start.current.x, start.current.y, p.x - start.current.x, p.y - start.current.y);
  }
  function up() { if (start.current) setMarks(value => value + 1); start.current = null; }
  function clear() { if (image.current) { const c = ctx(); c.drawImage(image.current, 0, 0); setMarks(0); } }

  return (
    <div className="annotator">
      <div className="annotator-tools">
        <strong>Mark up the screenshot</strong>
        <div className="seg" role="group" aria-label="Annotation tool"><button type="button" aria-pressed={tool === 'box'} onClick={() => setTool('box')}>Box</button><button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>Pen</button></div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!marks}>Clear marks</button>
      </div>
      <canvas ref={canvas} className="annotator-canvas" aria-label="Screenshot. Drag to draw a box or a line." onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className="preview-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Discard</button>
        <button type="button" className="btn btn-primary" onClick={() => canvas.current!.toBlob(blob => blob && onDone(blob, marks > 0), 'image/png')}>Attach screenshot</button>
      </div>
    </div>
  );
}

// ── Lists, threads, attachments ────────────────────────────────────────────

function FeedbackList({ quest, items, onOpen, empty }: { quest: Quest; items: FeedbackItem[]; onOpen: (id: string) => void; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="feedback-list">
      {items.map(item => (
        <li key={item.id}>
          <button type="button" onClick={() => onOpen(item.id)}>
            <span className={`fb-cat c-${item.category}`}>{FEEDBACK_CATEGORY_LABELS[item.category]}</span>
            <strong>{item.title}</strong>
            <small><Avatar state={quest.state} id={item.author} size="sm" /> {nameOf(quest.state, item.author)} · {new Date(item.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {item.context.view || 'Task-HQ'}{item.replies.length ? ` · ${item.replies.length} repl${item.replies.length === 1 ? 'y' : 'ies'}` : ''}{item.attachments.length ? ` · ${item.attachments.length} capture${item.attachments.length === 1 ? '' : 's'}` : ''}</small>
            <span className={`fb-status s-${item.status}`}>{FEEDBACK_STATUS_LABELS[item.status]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FeedbackThread({ quest, item, onNavigate }: { quest: Quest; item: FeedbackItem; onNavigate: (target: { taskId?: string; leadId?: string; route?: string }) => void }) {
  const { state, dispatch } = quest;
  const [reply, setReply] = useState('');
  const task = item.context.taskId ? taskById(state, item.context.taskId) : undefined;
  const lead = item.context.leadId ? leadById(state, item.context.leadId) : undefined;
  const linked = item.linkedTaskId ? taskById(state, item.linkedTaskId) : undefined;
  return (
    <article className="thread">
      <div className="thread-head">
        <span className={`fb-cat c-${item.category}`}>{FEEDBACK_CATEGORY_LABELS[item.category]}</span>
        <span className={`fb-status s-${item.status}`}>{FEEDBACK_STATUS_LABELS[item.status]}</span>
      </div>
      <h3>{item.title}</h3>
      <p className="thread-meta"><Avatar state={state} id={item.author} size="sm" /> {nameOf(state, item.author)}{person(state, item.author)?.role === 'reviewer' ? ' (reviewer)' : ''} · {new Date(item.createdAt).toLocaleString('en-US')}</p>
      <blockquote className="thread-original"><small>Original submission</small>{item.body || <em>No details.</em>}</blockquote>
      <div className="thread-context">
        <span>Screen: {item.context.view || '—'}</span>
        {task && <button type="button" className="link" onClick={() => onNavigate({ taskId: task.id })}>Task: {task.title} ↗</button>}
        {lead && <button type="button" className="link" onClick={() => onNavigate({ leadId: lead.id })}>Lead: {lead.name} ↗</button>}
        {!task && !lead && item.context.route && <button type="button" className="link" onClick={() => onNavigate({ route: item.context.route })}>Open that screen ↗</button>}
        <span>Version {item.context.version} · {item.context.viewport}</span>
      </div>
      {item.attachments.length > 0 && <div className="thread-media">{item.attachments.map(attachment => <AttachmentView key={attachment.id} quest={quest} attachment={attachment} />)}</div>}
      <ol className="thread-replies">
        {item.replies.map(entry => <li key={entry.id}><Avatar state={state} id={entry.by} size="sm" /><div><b>{nameOf(state, entry.by)}</b> <time>{clock(entry.at)}</time><p>{entry.body}</p></div></li>)}
      </ol>
      <form className="mini-form" onSubmit={async event => { event.preventDefault(); const result = await dispatch({ type: 'feedback/reply', id: item.id, body: reply }); if (result.ok) setReply(''); }}>
        <ReferenceInput value={reply} onChange={event => setReply(event.target.value)} maxLength={2000} placeholder="Reply or clarify…" aria-label="Reply" />
        <button className="btn btn-ghost btn-sm" disabled={!reply.trim()}>Reply</button>
      </form>
      <div className="thread-actions">
        {STATUSES.filter(status => status !== item.status && allowed(quest, { type: 'feedback/status', id: item.id, status })).map(status => (
          <button key={status} type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'feedback/status', id: item.id, status })}>Mark {FEEDBACK_STATUS_LABELS[status].toLowerCase()}</button>
        ))}
        {linked ? <button type="button" className="link" onClick={() => onNavigate({ taskId: linked.id })}>Development task: {linked.title} ({linked.status}) ↗</button>
          : allowed(quest, { type: 'feedback/convert', id: item.id }) && <button type="button" className="btn btn-primary btn-sm" onClick={() => void dispatch({ type: 'feedback/convert', id: item.id })}>Create development task</button>}
      </div>
      <details className="history"><summary>Activity ({item.history.length})</summary><ol>{item.history.map((entry, index) => <li key={index}><time>{clock(entry.at)}</time>{entry.text}</li>)}</ol></details>
    </article>
  );
}

function AttachmentView({ quest, attachment }: { quest: Quest; attachment: FeedbackItem['attachments'][number] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let created: string | null = null;
    deviceMediaStore.get(attachment.mediaId).then(blob => { if (blob) { created = URL.createObjectURL(blob); setUrl(created); } else setMissing(true); }).catch(() => setMissing(true));
    return () => { if (created) URL.revokeObjectURL(created); };
  }, [attachment.mediaId]);
  const label = `${attachment.kind === 'screenshot' ? 'Screenshot' : `Recording, ${duration(attachment.durationMs)}`}${attachment.annotated ? ', annotated' : ''} · by ${nameOf(quest.state, attachment.consentBy)} with consent at ${clock(attachment.consentAt)}`;
  return (
    <figure className="attachment">
      {missing ? <div className="attachment-missing">Stored on another device or browser — not available here.</div>
        : !url ? <div className="attachment-missing">Loading…</div>
        : attachment.kind === 'screenshot' ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={label} /></a>
        : <video src={url} controls preload="metadata" aria-label={label} />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

// ── Feedback inbox view ────────────────────────────────────────────────────

export function FeedbackInbox({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor } = quest;
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('all');
  const [category, setCategory] = useState<FeedbackCategory | 'all'>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const items = useMemo(() => state.feedback
    .filter(item => status === 'all' || item.status === status)
    .filter(item => category === 'all' || item.category === category)
    .filter(item => !mineOnly || item.author === actor), [state.feedback, status, category, mineOnly, actor]);
  return (
    <div className="view">
      <header className="view-head">
        <div><p className="eyebrow">Collaborative review · {quest.backend.kind === 'live' ? 'shared with your workspace' : 'stored on this device'}</p><h1>Feedback</h1><p className="lede">Comments, captures and decisions from reviewers and the team. Open one to reply, open the exact screen it’s about, resolve it, or turn it into a development task.</p></div>
      </header>
      <div className="filters">
        <Select value={status} onChange={event => setStatus(event.target.value as typeof status)} aria-label="Status"><option value="all">All statuses</option>{STATUSES.map(value => <option key={value} value={value}>{FEEDBACK_STATUS_LABELS[value]}</option>)}</Select>
        <Select value={category} onChange={event => setCategory(event.target.value as typeof category)} aria-label="Category"><option value="all">All categories</option>{CATEGORIES.map(value => <option key={value} value={value}>{FEEDBACK_CATEGORY_LABELS[value]}</option>)}</Select>
        <label className="check-row"><input type="checkbox" checked={mineOnly} onChange={event => setMineOnly(event.target.checked)} /> Only mine</label>
        <span className="filters-count">{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      <FeedbackList quest={quest} items={items} onOpen={onOpen} empty="No feedback yet. Use the Feedback button on any screen." />
      {quest.backend.kind !== 'live' && <InvitePanel quest={quest} />}
    </div>
  );
}

function InvitePanel({ quest }: { quest: Quest }) {
  const { state, now, dispatch } = quest;
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(14);
  const canInvite = allowed(quest, { type: 'invite/draft', email: 'check@example.com', days: 7 });
  if (!canInvite && !state.invites.length) return null;
  return (
    <section className="panel invite">
      <h3>Reviewer invitations</h3>
      <p><b>Not sent — needs a Task-HQ backend.</b> Task-HQ can’t send invitations or verify identity yet. A draft records exactly who should get reviewer access, for how long, and what they can do, so it’s ready the moment authenticated access exists.</p>
      <ul className="scope">{REVIEWER_SCOPE.map(line => <li key={line}>{line}</li>)}<li className="is-denied">No changes to tasks, leads, people, policy or company records</li></ul>
      {canInvite && (
        <form className="inline-form" onSubmit={async event => { event.preventDefault(); const result = await dispatch({ type: 'invite/draft', email, days }); if (result.ok) setEmail(''); }}>
          <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Reviewer’s verified email" aria-label="Reviewer email" required />
          <label className="secs">expires in <input type="number" min={1} max={30} value={days} onChange={event => setDays(Number(event.target.value))} aria-label="Days until expiry" /> days</label>
          <button className="btn btn-dark btn-sm" disabled={!email.trim()}>Save draft</button>
        </form>
      )}
      {state.invites.length > 0 && (
        <ul className="invite-list">
          {state.invites.map(invite => (
            <li key={invite.id}>
              <span>{invite.email}</span>
              <small>{invite.status === 'revoked' ? `Revoked ${clock(invite.revokedAt ?? now)}` : invite.expiresAt < now ? 'Expired' : `Draft · not sent · expires ${new Date(invite.expiresAt).toLocaleDateString('en-US')}`}</small>
              {invite.status === 'draft' && canInvite && <button type="button" className="link" onClick={() => void dispatch({ type: 'invite/revoke', id: invite.id })}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Reviewer welcome (onboarding) ──────────────────────────────────────────

export function ReviewerWelcome({ quest, onOpenFeedback, go }: { quest: Quest; onOpenFeedback: () => void; go: (view: string) => void }) {
  const me = person(quest.state, quest.actor);
  const mine = quest.state.feedback.filter(item => item.author === quest.actor);
  return (
    <section className="situation reviewer-welcome">
      <span className="situation-kicker">REVIEWER · LOCAL PREVIEW</span>
      <h2 className="situation-headline">Welcome, {me?.name}. Look around and tell us what you think.</h2>
      <p className="situation-detail">This is the Task-HQ preview with made-up people, jobs and leads. Nothing you do here changes real company records.</p>
      <div className="welcome-grid">
        <div><b>You can</b><ul>{REVIEWER_SCOPE.map(line => <li key={line}>{line}</li>)}</ul></div>
        <div><b>Try these screens</b><ul>
          <li><button type="button" className="link" onClick={() => go('company-work')}>Projects</button> — every job the team is moving</li>
          <li><button type="button" className="link" onClick={() => go('leads')}>Speed to Lead</button> — select a lead to open its instrument deck</li>
          <li><button type="button" className="link" onClick={() => go('needs-attention')}>Needs Attention</button> — what Task-HQ flags and why</li>
        </ul></div>
      </div>
      {quest.backend.kind !== 'live' && <p className="situation-why">To see a handoff happen, switch “Working as” to Maya Chen, complete her task, then switch to Alex Morgan. Switch back to Abraham to leave feedback.</p>}
      <div className="situation-actions">
        <button type="button" className="offer offer-primary" onClick={onOpenFeedback}><span>Leave feedback on this screen</span><span className="offer-arrow" aria-hidden="true">→</span></button>
        <button type="button" className="offer offer-secondary" onClick={() => go('feedback')}>Your feedback ({mine.length})</button>
      </div>
      <p className="boundary">{quest.backend.kind === 'live' ? `Reviewers can read ${quest.state.workspace.name}’s work and leave feedback; the server refuses any change to operational work.` : 'Local preview on this device. Feedback isn’t shared with anyone until a Task-HQ backend with sign-in is approved.'}</p>
    </section>
  );
}
