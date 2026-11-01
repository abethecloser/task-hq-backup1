import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TopTab } from './TopBar.tsx';

/** One destination, as the rail lists it (the same records drive both). */
export interface NavSection { id: string; label: string; icon: ReactNode; count?: number; countLabel?: string; hot?: boolean; preview?: boolean; active?: boolean }

/** How sections group in the labelled navigator; anything unlisted falls into Workspace. */
const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Work', ids: ['home', 'all-tasks', 'company-work', 'calendar', 'inbox'] },
  { label: 'Insights', ids: ['reports', 'needs-attention', 'executive', 'activity'] },
  { label: 'Workspace', ids: ['archive', 'people', 'settings'] },
];
const PROJECT_LIMIT = 8;

// The workspace navigator: every destination with its label, Tasks views and individual Projects
// nested under their parent. The icon rail is its collapsed form and phones open it as the menu,
// so there is one hierarchy and one set of destinations everywhere. Task views reuse the top bar's
// task filters, so counts always agree.
export function WorkNavigator({ sections, lenses, projects, activeProjectId, onSelect, onLens, onProject }: {
  sections: NavSection[]; lenses: TopTab[];
  projects: { id: string; name: string; open: number }[]; activeProjectId: string | null;
  onSelect: (id: string) => void; onLens: (id: string) => void; onProject: (id: string) => void;
}) {
  const [previewsOpen, setPreviewsOpen] = useState(false);
  const everyday = sections.filter(item => !item.preview);
  const previews = sections.filter(item => item.preview);
  const showPreviews = previewsOpen || previews.some(item => item.active);
  const grouped = GROUPS.map(group => ({ ...group, items: group.ids.map(id => everyday.find(item => item.id === id)).filter((item): item is NavSection => !!item) }));
  const rest = everyday.filter(item => !GROUPS.some(group => group.ids.includes(item.id)));
  grouped[grouped.length - 1]!.items.push(...rest);
  const shown = projects.slice(0, PROJECT_LIMIT);

  // A parent whose view or project is the current page reads as "you are in here", not as a second
  // current page; the child carries the active highlight.
  const childActive = (id: string) => (id === 'all-tasks' && lenses.some(lens => lens.active)) || (id === 'company-work' && !!activeProjectId);
  const row = (item: NavSection) => (
    <button type="button" className={`work-nav-item is-section ${item.active && !childActive(item.id) ? 'is-active' : ''} ${childActive(item.id) ? 'has-active-child' : ''}`} aria-current={item.active && !childActive(item.id) ? 'page' : undefined}
      aria-label={`${item.label}${item.preview ? ', preview' : ''}${item.count && item.countLabel ? `, ${item.count} ${item.countLabel}` : ''}`}
      onClick={() => onSelect(item.id)}>
      <span className="work-nav-icon" aria-hidden="true">{item.icon}</span><span className="work-nav-text">{item.label}</span>
      {item.count ? <b className={item.hot ? 'is-hot' : ''}>{item.count}</b> : null}
    </button>
  );

  return (
    <nav className="work-nav" aria-label="Workspace">
      {grouped.filter(group => group.items.length).map(group => (
        <div key={group.label} className="work-nav-group" role="group" aria-label={group.label}>
          <p className="work-nav-label">{group.label}</p>
          <ul className="work-list">
            {group.items.map(item => (
              <li key={item.id}>
                {row(item)}
                {item.id === 'all-tasks' && lenses.length > 0 && <ul className="work-sub" aria-label="Task views">
                  {lenses.map(lens => <li key={lens.id}><button type="button" className={`work-nav-item ${lens.active ? 'is-active' : ''}`} aria-current={lens.active ? 'page' : undefined} onClick={() => onLens(lens.id)}>
                    <span className="work-nav-text">{lens.label}</span>{lens.count !== undefined && <b className={lens.hot ? 'is-hot' : ''}>{lens.count}</b>}
                  </button></li>)}
                </ul>}
                {item.id === 'company-work' && shown.length > 0 && <ul className="work-sub" aria-label="Projects">
                  {shown.map(project => <li key={project.id}><button type="button" className={`work-nav-item ${project.id === activeProjectId ? 'is-active' : ''}`} aria-current={project.id === activeProjectId ? 'page' : undefined} onClick={() => onProject(project.id)}>
                    <span className="work-nav-text">{project.name}</span>{project.open > 0 && <b>{project.open}</b>}
                  </button></li>)}
                  {projects.length > PROJECT_LIMIT && <li><button type="button" className="work-nav-item is-more" onClick={() => onSelect('company-work')}><span className="work-nav-text">All {projects.length} projects</span></button></li>}
                </ul>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {previews.length > 0 && <div className="work-nav-group" role="group" aria-label="Previews">
        <button type="button" className={`work-nav-label work-nav-toggle ${showPreviews ? 'is-open' : ''}`} aria-expanded={showPreviews} onClick={() => setPreviewsOpen(open => !open)}>
          Previews <small>not ready for daily use</small>
        </button>
        {showPreviews && <ul className="work-list">{previews.map(item => <li key={item.id}>{row(item)}</li>)}</ul>}
      </div>}
    </nav>
  );
}
