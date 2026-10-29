// New project: the same dialog shell as New task (kicker, title, card sections, readiness
// checklist), sized for one field. Supervisors, admins and owners create projects; the engine
// enforces it (`project/create`) and the live server refuses it until dispatch v7 is deployed.
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { QuestState } from '../core/contract.ts';
import { coordinates, observes, person } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';

export function canCreateProject(state: QuestState, actor: string): boolean {
  const me = person(state, actor);
  return !!me && !observes(me) && coordinates(me);
}

export function CreateProject({ quest, onClose, onCreated }: { quest: Quest; onClose: () => void; onCreated: (projectId: string, addTask: boolean) => void }) {
  const { state, actor, dispatch } = quest;
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = name.trim();
  const duplicate = !!clean && state.projects.some(project => project.name.toLowerCase() === clean.toLowerCase());
  const supported = quest.backend.supports?.projectCreate !== false;
  const allowed = canCreateProject(state, actor);
  const refusal = !supported ? 'Creating projects needs the server update (dispatch v7). Nothing will be sent.' : !allowed ? 'Only a supervisor, admin or owner can create projects.' : '';
  const ready = !!clean && !duplicate && !refusal;
  const checks = [
    { label: 'Named', ok: !!clean, note: clean ? undefined : 'Give it a name people will recognize.' },
    { label: 'Unique name', ok: !!clean && !duplicate, note: duplicate ? 'A project with this name already exists.' : undefined },
    { label: 'Allowed for you', ok: !refusal, note: refusal || undefined },
  ];

  async function submit(event: FormEvent, addTask = false) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const before = new Set(state.projects.map(project => project.id));
    const result = await dispatch({ type: 'project/create', name: clean });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    const created = result.state.projects.find(project => !before.has(project.id));
    onCreated(created?.id ?? '', addTask);
  }

  return (
    <>
      <button className="scrim scrim-modal" aria-label="Close" onClick={onClose} />
      <section className="modal create-wide create-project" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
        <header className="modal-head"><div><span className="kicker">NEW PROJECT</span><h2 id="create-project-title">Create a project</h2></div>
          <div className="modal-head-actions"><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button></div>
        </header>
        <div className="cx">
          <div className="cx-form">
            <form id="create-project-form" className="cx-fields" onSubmit={event => submit(event)}>
              <label className="field cx-title"><span>Project name</span>
                <input autoFocus required maxLength={80} value={name} placeholder="e.g. Smith Residence — roof replacement" onChange={event => { setName(event.target.value); setError(''); }} /></label>
              <section className="cx-card" aria-labelledby="cp-what">
                <h3 id="cp-what" className="cx-sec"><i>01</i> What happens next</h3>
                <p className="muted">The project appears on Projects, in every Project picker (New task, filters, Calendar) and in Projects and Team Overview. Add its first task now or later.</p>
              </section>
              {error && <p className="form-error" role="alert">{error}</p>}
              <footer className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="btn" disabled={!ready || busy} onClick={event => submit(event, true)}>Create and add a task</button>
                <button className="btn btn-primary" disabled={!ready || busy} aria-busy={busy}>{busy ? 'Creating…' : 'Create project →'}</button>
              </footer>
            </form>
          </div>
          <aside className="cx-preview is-open" aria-label="Project preview">
            <div className="cx-preview-body">
              <p className="cx-kicker">PROJECT PREVIEW</p>
              <h3 className={`cx-preview-title ${clean ? '' : 'is-empty'}`}>{clean || 'Untitled project'}</h3>
              <dl className="cx-facts"><div><dt>Tasks</dt><dd>None yet</dd></div><div><dt>Projects today</dt><dd>{state.projects.length}</dd></div></dl>
              <p className="cx-kicker">READY TO CREATE</p>
              <ul className="cx-checks">{checks.map(check => <li key={check.label} className={check.ok ? 'is-ok' : 'is-todo'}><span aria-hidden="true">{check.ok ? '●' : '○'}</span><b>{check.label}</b>{check.note && <small>{check.note}</small>}</li>)}</ul>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
