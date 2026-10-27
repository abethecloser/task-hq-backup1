import type { Project } from '../core/contract.ts';
import type { TopTab } from './TopBar.tsx';

// Below the calendar: the task views with live counts, as a centered group, then Projects.
// It reuses the top bar's task filters, so both always agree.
export function WorkNavigator({ lenses, projects, onLens, onProjects }: {
  lenses: TopTab[]; projects: Project[]; onLens: (id: string) => void; onProjects: () => void;
}) {
  return (
    <nav className="work-nav" aria-labelledby="work-views-title">
      <p id="work-views-title" className="work-nav-label">Work views</p>
      <div className="work-chips">
        {lenses.map(lens => (
          <button key={lens.id} type="button" className={`work-chip ${lens.active ? 'is-active' : ''}`} aria-current={lens.active ? 'page' : undefined} onClick={() => onLens(lens.id)}>
            {lens.label}{lens.count !== undefined && <b className={lens.hot ? 'is-hot' : ''}>{lens.count}</b>}
          </button>
        ))}
        {projects.length > 0 && <button type="button" className="work-chip" onClick={onProjects}>Projects<b>{projects.length}</b></button>}
      </div>
    </nav>
  );
}
