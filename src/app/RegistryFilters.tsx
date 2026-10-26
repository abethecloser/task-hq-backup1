// All Tasks filters: an inline, collapsible section under the toolbar (no drawer, no
// overlay), plus the removable chips that show which filters are on while it's collapsed.
// Status, Priority and Due date take several chips at once (a task matches any picked chip in
// a group; groups combine). Assigned to and Project pick one. Choices are a draft until
// Apply, and the draft survives collapsing the section.
import { useDropdown } from '../ui/useDropdown.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { QuestState } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { BOARD_ORDER, asList } from '../core/registry.ts';
import type { DueFilter, PriorityFilter, RegistryQuery, StatusFilter } from '../core/registry.ts';
import { nameOf, projectName } from '../core/selectors.ts';

/** The panel's view of the query: chip groups as lists ([] = any), people and project as one id. */
export interface FilterFields { status: StatusFilter[]; priority: PriorityFilter[]; due: DueFilter[]; owner: string; project: string }
/** Draft edits: plain changes, or a function of the latest draft (so quick successive toggles never read a stale list). */
export type DraftEdit = Partial<FilterFields> | ((draft: FilterFields) => Partial<FilterFields>);
type ChipField = 'status' | 'priority' | 'due';
export const FILTER_DEFAULTS: FilterFields = { status: ['open'], priority: [], due: [], owner: '', project: '' };
const FIELDS = Object.keys(FILTER_DEFAULTS) as (keyof FilterFields)[];
const withoutAny = <T extends string>(values: T[]) => values.filter(value => value !== 'any');
const same = (a: string | string[], b: string | string[]) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every(value => b.includes(value)) : a === b);

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [{ value: 'open', label: 'Open' }, ...BOARD_ORDER.map(status => ({ value: status, label: status === 'done' ? 'Completed' : STATUS_LABELS[status] })), { value: 'archived', label: 'Archived' }];
const PRIORITY_CHIPS: { value: PriorityFilter; label: string }[] = [{ value: 'ultra', label: 'Ultra Priority' }, { value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }];
const DUE_CHIPS: { value: DueFilter; label: string }[] = [{ value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Due today' }, { value: 'week', label: 'Next 7 days' }, { value: 'none', label: 'No due date' }];

export const filterFields = (query: RegistryQuery): FilterFields => ({
  status: withoutAny(asList(query.status)), priority: withoutAny(asList(query.priority)), due: withoutAny(asList(query.due)), owner: query.owner, project: query.project,
});
export const sameFilters = (a: FilterFields, b: FilterFields) => FIELDS.every(field => same(a[field], b[field]));
const activeFields = (fields: FilterFields) => FIELDS.filter(field => !same(fields[field], FILTER_DEFAULTS[field]));

/** How many filter groups differ from the defaults (search is shown separately). The job (project)
 *  shows in its own toolbar picker, so the Filters badge and chips can leave it out. */
export function activeFilterCount(query: RegistryQuery, { includeJob = true } = {}) {
  return activeFields(filterFields(query)).filter(field => includeJob || field !== 'project').length;
}

/** One removable chip per active filter. */
export function ActiveFilters({ state, actor, query, onRemove }: {
  state: QuestState; actor: string; query: RegistryQuery; onRemove: (changes: Partial<FilterFields>) => void;
}) {
  const fields = filterFields(query);
  const chips = activeFields(fields).filter(field => field !== 'project').map(field => ({ field, label: chipLabel(state, actor, field, fields) }));
  if (!chips.length) return null;
  return (
    <ul className="filter-chips" aria-label="Active filters">
      {chips.map(chip => (
        <li key={chip.field}>
          <button type="button" className="filter-chip" onClick={() => onRemove({ [chip.field]: FILTER_DEFAULTS[chip.field] })} aria-label={`Remove filter ${chip.label}`}>
            {chip.label}<svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

function chipLabel(state: QuestState, actor: string, field: keyof FilterFields, fields: FilterFields) {
  const names = (values: string[], options: { value: string; label: string }[]) => (values.length ? values.map(value => options.find(item => item.value === value)?.label ?? value).join(', ') : 'Any');
  switch (field) {
    case 'status': return `Status: ${names(fields.status, STATUS_CHIPS)}`;
    case 'priority': return `Priority: ${names(fields.priority, PRIORITY_CHIPS)}`;
    case 'due': return `Due: ${names(fields.due, DUE_CHIPS)}`;
    case 'owner': return fields.owner === 'none' ? 'No owner' : `Assigned: ${fields.owner === actor ? 'You' : nameOf(state, fields.owner)}`;
    case 'project': return fields.project === 'none' ? 'No project' : `Project: ${projectName(state, fields.project)}`;
  }
}

function toggle<T>(values: T[], value: T) {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

/** The expandable section. Always mounted so it can animate; inert while collapsed. */
export function FilterSection({ id, open, state, actor, draft, pending, onDraft, onApply, onClearAll }: {
  id: string; open: boolean; state: QuestState; actor: string; draft: FilterFields; pending: boolean;
  onDraft: (edit: DraftEdit) => void; onApply: () => void; onClearAll: () => void;
}) {

  return (
    <div id={id} className={`filter-section ${open ? 'is-open' : ''}`} inert={!open} aria-hidden={!open}>
      <div className="filter-section-clip">
        <section className="filter-section-inner" aria-label="Filters">
          <div className="filter-grid is-chips">
            <ChipGroup title="Status" field="status" options={STATUS_CHIPS} draft={draft} onDraft={onDraft} />
            <ChipGroup title="Priority" field="priority" options={PRIORITY_CHIPS} draft={draft} onDraft={onDraft} />
            <ChipGroup title="Due date" field="due" options={DUE_CHIPS} draft={draft} onDraft={onDraft} />
          </div>
          <div className="filter-grid is-lists">
            <SearchSelector key={`owner-${open}`} title="Assigned to" placeholder="Search team members…" value={draft.owner}
              options={[{ id: '', name: 'Any Owner' }, { id: 'none', name: 'No Owner' }, ...state.people.filter(item => item.role !== 'reviewer').map(item => ({ id: item.id, name: item.id === actor ? `${item.name} (you)` : item.name }))]}
              onPick={owner => onDraft({ owner })} />
            <SearchSelector key={`project-${open}`} title="Project" placeholder="Search projects…" value={draft.project}
              options={[{ id: '', name: 'Any Project' }, { id: 'none', name: 'No Project' }, ...state.projects]}
              onPick={project => onDraft({ project })} />
          </div>
          <footer className="filter-section-foot">
            <span className="filter-pending" aria-live="polite">{pending ? 'Changes not applied yet' : ''}</span>
            <button type="button" className="btn" onClick={onClearAll}>Clear all</button>
            <button type="button" className="btn btn-primary" disabled={!pending} onClick={onApply}>Apply filters</button>
          </footer>
        </section>
      </div>
    </div>
  );
}

function Group({ title, any, onAny, children }: { title: string; any: boolean; onAny: () => void; children: ReactNode }) {
  return (
    <section className="filter-group">
      <div className="filter-group-head">
        <h3>{title}</h3>
        <button type="button" className={`filter-any ${any ? 'is-on' : ''}`} aria-pressed={any} onClick={onAny}>Any</button>
      </div>
      {children}
    </section>
  );
}

/** Toggle chips: pick as many as you like; none picked (or Any) means no limit. */
function ChipGroup<F extends ChipField>({ title, field, options, draft, onDraft }: {
  title: string; field: F; options: { value: FilterFields[F][number]; label: string }[]; draft: FilterFields; onDraft: (edit: DraftEdit) => void;
}) {
  const picked = draft[field] as string[];
  return (
    <Group title={title} any={picked.length === 0} onAny={() => onDraft({ [field]: [] })}>
      <div className="filter-options" role="group" aria-label={`${title} (pick any)`}>
        {options.map(option => {
          const on = picked.includes(option.value);
          return <button key={option.value} type="button" aria-pressed={on} className={`filter-option ${on ? 'is-on' : ''}`} onClick={() => onDraft(latest => ({ [field]: toggle(latest[field] as string[], option.value) }))}>{option.label}</button>;
        })}
      </div>
    </Group>
  );
}

/** Options come only from the permission-scoped workspace state. Selection edits the draft. */
function SearchSelector({ title, placeholder, value, options, onPick }: {
  title: string; placeholder: string; value: string; options: { id: string; name: string }[]; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240, transform: 'none' });
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = input.current?.closest('label')?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 180 && above > below;
      const maxHeight = Math.min(240, Math.max(80, up ? above : below));
      setPosition({ top: up ? rect.top - 4 : rect.bottom + 4, transform: up ? 'translateY(-100%)' : 'none',
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), width: Math.min(rect.width, window.innerWidth - 16), maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useDropdown({ open, onClose: () => { setOpen(false); setTerm(''); }, trigger: () => input.current, content: () => popover.current, region: () => root.current });
  useEffect(() => { popover.current?.querySelector(`[id="${CSS.escape(id)}-${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, term]);
  const shown = options.filter(option => option.name.toLowerCase().includes(term.trim().toLowerCase()));
  const selected = options.find(option => option.id === value)?.name ?? '';
  function pick(option: { id: string }) { onPick(option.id); input.current?.focus(); setOpen(false); setTerm(''); }
  return (
    <section ref={root} className="filter-group filter-selector" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !popover.current?.contains(event.relatedTarget)) { setOpen(false); setTerm(''); } }}>
      <div className="filter-group-head"><h3><label htmlFor={id}>{title}</label></h3></div>
      <label className="search-field filter-find">
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
        <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`}
          aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
          value={open ? term : selected} placeholder={placeholder}
          onFocus={() => { setOpen(true); setActive(0); }} onClick={() => setOpen(true)}
          onChange={event => { setTerm(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setTerm(''); }
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(shown.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
            else if (event.key === 'Enter' && open && shown[active]) { event.preventDefault(); pick(shown[active]); }
          }} />
      </label>
      {open && createPortal(<div ref={popover} style={position} className="filter-list filter-selector-popover" id={`${id}-options`} role="listbox" aria-label={title}>
        {shown.map((option, index) => <button type="button" tabIndex={-1} key={option.id} id={`${id}-${index}`} role="option" aria-selected={option.id === value}
          className={`filter-person ${option.id === value ? 'is-on' : ''} ${index === active ? 'is-highlighted' : ''}`}
          onMouseDown={event => event.preventDefault()} onClick={() => pick(option)}>{option.name}</button>)}
        {!shown.length && <p className="muted" role="status">No matches.</p>}
      </div>, document.body)}
    </section>
  );
}
