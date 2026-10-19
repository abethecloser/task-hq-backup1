// All Jobs: a compact, searchable picker left of Search with two sections:
//   Companies (Roofing, Drafting, Lumen) — tasks fill in automatically from their workspace,
//     job, tags and type (see core/companies.ts);
//   Jobs — the workspace's projects, which set the same project filter as Filters → Project.
// Picking one clears the other; it never touches scope, lens, search or other filters.
// Jobs come from the loaded workspace state, which is already permission-scoped.
import { useDropdown } from '../ui/useDropdown.tsx';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { QuestState } from '../core/contract.ts';
import { COMPANIES, companiesOf, companyLabel, workspaceCompanies } from '../core/companies.ts';
import type { CompanyId } from '../core/companies.ts';
import { inScope } from '../core/registry.ts';
import type { Scope } from '../core/registry.ts';
import { isOpen } from '../core/selectors.ts';

export interface JobChoice { project: string; company: CompanyId | '' }
interface PickerOption { key: string; name: string; choice: JobChoice; count?: number; section?: string }

export function JobPicker({ state, actor, scope, project, company, onChange }: {
  state: QuestState; actor: string; scope: Scope; project: string; company: CompanyId | ''; onChange: (choice: JobChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const menu = useRef<HTMLDivElement>(null);
  useDropdown({ open, onClose: () => setOpen(false), trigger: () => button.current, content: () => menu.current, region: () => root.current });

  // Open-task counts within the current My work / Company scope.
  const openTasks = state.tasks.filter(task => isOpen(task) && inScope(task, actor, scope));
  const inWorkspace = workspaceCompanies(state);
  const term = find.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(term);
  const options: PickerOption[] = [
    ...(term ? [] : [{ key: 'all', name: 'All Jobs', choice: { project: '', company: '' as const } }]),
    ...COMPANIES.filter(item => matches(item.label)).map((item, index) => ({
      key: `company:${item.id}`, name: item.label, section: index === 0 ? 'Companies' : undefined, choice: { project: '', company: item.id },
      count: openTasks.filter(task => companiesOf(state, task, inWorkspace).has(item.id)).length,
    })),
    ...state.projects.filter(item => matches(item.name)).map((item, index) => ({
      key: `job:${item.id}`, name: item.name, section: index === 0 ? 'Jobs' : undefined, choice: { project: item.id, company: '' as const },
      count: openTasks.filter(task => task.projectId === item.id).length,
    })),
    ...(term ? [] : [{ key: 'job:none', name: 'No job', choice: { project: 'none', company: '' as const }, count: openTasks.filter(task => !task.projectId).length }]),
  ];
  const isSelected = (choice: JobChoice) => choice.project === project && choice.company === company;
  const label = company ? companyLabel(company) : project === '' ? 'All Jobs' : project === 'none' ? 'No job' : state.projects.find(item => item.id === project)?.name ?? 'All Jobs';

  useEffect(() => {
    if (!open) return;
    setFind('');
    setActive(Math.max(0, options.findIndex(option => isSelected(option.choice))));
    input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(choice: JobChoice) {
    onChange(choice);
    setOpen(false);
    button.current?.focus();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(options.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === 'Enter' && options[active]) { event.preventDefault(); pick(options[active]!.choice); }
  }

  return (
    <div className={`job-picker ${project || company ? 'is-set' : ''}`} ref={root} onKeyDown={open ? onKey : undefined}>
      <button ref={button} type="button" className="job-picker-button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Job: ${label}`} onClick={() => setOpen(current => !current)}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" /></svg>
        <span className="job-picker-label">{label}</span>
        <svg className="icon job-picker-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div ref={menu} className="job-picker-menu">
          <label className="search-field job-picker-find">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
            <input ref={input} type="search" value={find} placeholder="Search companies and jobs…" aria-label="Search companies and jobs" aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined} onChange={event => { setFind(event.target.value); setActive(0); }} />
          </label>
          <ul id={listId} role="listbox" aria-label="Jobs" className="job-picker-list">
            {options.map((option, index) => (
              <Fragment key={option.key}>
                {option.section && <li className="job-picker-section" role="presentation">{option.section}</li>}
                <li id={`${listId}-${index}`} role="option" aria-selected={isSelected(option.choice)}
                  className={`${index === active ? 'is-active' : ''} ${isSelected(option.choice) ? 'is-on' : ''}`}
                  onPointerEnter={() => setActive(index)} onClick={() => pick(option.choice)}>
                  <span>{option.name}</span>
                  {option.count !== undefined && <small>{option.count}</small>}
                </li>
              </Fragment>
            ))}
            {options.length === 0 && <li className="job-picker-empty" role="presentation">No job matches “{find}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
