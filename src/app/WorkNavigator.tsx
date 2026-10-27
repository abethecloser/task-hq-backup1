import type { Project } from '../core/contract.ts';
import type { TopTab } from './TopBar.tsx';

// The left edge answers "where": the task views with live counts, then the projects.
// It reuses the top bar's task filters, so both always agree.
export function WorkNavigator({ lenses, projects, onLens, onProjects }: {
  lenses: TopTab[]; projects: Project[]; onLens: (id: string) => void; onProjects: () => void;
}) {
  return (
    <nav className="work-nav" aria-label="Your work">
      <p className="work-nav-label">Views</p>
      <ul>
        {lenses.map(lens => (
          <li key={lens.id}>
            <button type="button" className={`work-nav-item ${lens.active ? 'is-active' : ''}`} aria-current={lens.active ? 'page' : undefined} onClick={() => onLens(lens.id)}>
              <span>{lens.label}</span>{lens.count !== undefined && <b className={lens.hot ? 'is-hot' : ''}>{lens.count}</b>}
            </button>
          </li>
        ))}
      </ul>
      {projects.length > 0 && <>
        <p className="work-nav-label">Projects</p>
        <ul>
          {projects.map(project => (
            <li key={project.id}><button type="button" className="work-nav-item" onClick={onProjects}><span>{project.name}</span></button></li>
          ))}
        </ul>
      </>}
    </nav>
  );
}
