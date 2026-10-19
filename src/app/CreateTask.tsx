import { Select } from '../ui/Select.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { NewTask } from '../core/contract.ts';
import { localDate } from '../core/time.ts';
import { hasRole } from '../core/selectors.ts';
import { PersonSelect } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import type { Draft } from '../core/command.ts';
import { Composer } from './Composer.tsx';

export function CreateTask({ quest, onClose, onCreated }: { quest: Quest; onClose: () => void; onCreated: (id: string) => void }) {
  const { state, actor, now, dispatch } = quest;
  // Managers delegate: creating work doesn't make them its owner by default.
  const delegates = hasRole(state, actor, ['manager']);
  const [draft, setDraft] = useState<NewTask>({ title: '', owner: delegates ? '' : actor, due: localDate(now), priority: 'normal', nextAction: '', approver: '', nextOwner: '', projectId: '', dependsOn: [] });
  const set = (changes: Partial<NewTask>) => setDraft(current => ({ ...current, ...changes }));
  const taxonomyOk = quest.backend.supports?.taskTaxonomy !== false;
  const types = state.taxonomy?.types ?? [];
  // Proposed people from the one-line description are suggestions until chosen.
  const [proposed, setProposed] = useState<{ owner?: { id: string; name: string }; approver?: { id: string; name: string } }>({});
  function fill(parsed: Draft) {
    const member = (p: Draft['owner']) => (p && p.ref.kind === 'member' ? { id: p.ref.id, name: p.ref.name } : undefined);
    set({ title: parsed.title, priority: parsed.priority, ...(parsed.due ? { due: parsed.due } : {}),
      ...(taxonomyOk ? { type: parsed.type || undefined, tags: parsed.tags.map(item => item.tag), dueTime: parsed.dueTime || undefined } : {}),
      watchers: [] });
    setProposed({ owner: member(parsed.owner), approver: member(parsed.approver) });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await dispatch({ type: 'task/create', task: draft });
    if (result.ok) onCreated(result.state.tasks[0]!.id);
  }

  return (
    <>
      <button className="scrim scrim-modal" aria-label="Close" onClick={onClose} />
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header className="modal-head"><div><span className="kicker">NEW WORK</span><h2 id="create-title">Create a task</h2></div><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="form create-composer"><Composer quest={quest} variant="form" onFill={fill} /></div>
        <form className="form" onSubmit={submit}>
          <label className="field"><span>What needs to get done?</span><ReferenceInput autoFocus required maxLength={160} value={draft.title} onChange={event => set({ title: event.target.value })} placeholder="e.g. Confirm the dumpster drop-off for Maple Ave" /></label>
          <label className="field"><span>Next action</span><ReferenceInput maxLength={200} value={draft.nextAction} onChange={event => set({ nextAction: event.target.value })} placeholder="The first physical step" /></label>
          <label className="field"><span>Description / notes</span><ReferenceTextarea rows={3} value={draft.description ?? ''} maxLength={1000} onChange={event => set({ description: event.target.value })} placeholder="Context, @people and #tags" /></label>
          <div className="form-grid">
            <label className="field"><span>Owner</span><small className="field-hint">{delegates ? 'Who moves this forward. You don’t have to own what you create.' : 'Accountable for moving this task forward.'}</small><PersonSelect state={state} label="Owner" value={draft.owner ?? ''} emptyLabel={delegates ? 'Choose later (unassigned)' : 'Unassigned'} onChange={owner => set({ owner })} />
              {proposed.owner && draft.owner !== proposed.owner.id && <button type="button" className="proposal-chip" onClick={() => set({ owner: proposed.owner!.id })}>Proposed: {proposed.owner.name} · <b>Use</b></button>}</label>
            <label className="field"><span>Approver</span><PersonSelect state={state} label="Approver" value={draft.approver ?? ''} emptyLabel="No approval needed" onChange={approver => set({ approver })} />
              {proposed.approver && draft.approver !== proposed.approver.id && <button type="button" className="proposal-chip" onClick={() => set({ approver: proposed.approver!.id })}>Proposed: {proposed.approver.name} · <b>Use</b></button>}</label>
            <label className="field"><span>Next-step owner</span><small className="field-hint">Receives the handoff when this work is ready to move on.</small><PersonSelect state={state} label="Next-step owner" value={draft.nextOwner ?? ''} onChange={nextOwner => set({ nextOwner })} /></label>
            <label className="field"><span>Due</span><span className="draft-when"><input type="date" value={draft.due} onChange={event => set({ due: event.target.value, ...(event.target.value ? {} : { dueTime: undefined }) })} />{taxonomyOk && <input type="time" value={draft.dueTime ?? ''} disabled={!draft.due} aria-label="Due time" onChange={event => set({ dueTime: event.target.value || undefined })} />}</span></label>
            {taxonomyOk && types.length > 0 && <label className="field"><span>Type</span><Select value={draft.type ?? ''} onChange={event => set({ type: event.target.value || undefined })}><option value="">No type</option>{types.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>}
            <label className="field"><span>Priority</span><Select value={draft.priority} onChange={event => set({ priority: event.target.value as NewTask['priority'] })}><option value="normal">Normal</option><option value="high">High</option></Select></label>
            <label className="field"><span>Project</span><Select value={draft.projectId} onChange={event => set({ projectId: event.target.value })}><option value="">No project</option>{state.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          </div>
          <label className="field"><span>Starts after</span>
            <Select value={draft.dependsOn?.[0] ?? ''} onChange={event => set({ dependsOn: event.target.value ? [event.target.value] : [] })}>
              <option value="">No dependency — can start now</option>
              {state.tasks.filter(task => task.status !== 'done').map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
            </Select>
          </label>
          <footer className="form-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!draft.title.trim()}>Create task →</button></footer>
        </form>
      </section>
    </>
  );
}
