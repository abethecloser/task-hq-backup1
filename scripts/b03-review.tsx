// Component review only: synthetic records, no auth client or backend.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from '../src/app/Home.tsx';
import { CompanyWork } from '../src/app/CompanyWork.tsx';
import { NotificationDrawer } from '../src/app/NotificationDrawer.tsx';
import { PANEL_DEFAULT } from '../src/app/Sidebar.tsx';
import type { AwarenessTab, SidebarControl } from '../src/app/Sidebar.tsx';
import type { CSSProperties } from 'react';
import { seedState } from '../src/core/seed.ts';
import type { Quest } from '../src/ui/useQuest.ts';
import '../src/ui/quest.css';
import '../src/ui/nexus.css';
import '../src/ui/studio.css';
import '../src/ui/home.css';
import '../src/ui/brutalist.css';

const now = Date.now(), state = seedState(now);
const params = new URLSearchParams(location.search);
const actor = ['jordan', 'maya', 'alex'].includes(params.get('actor') || '') ? params.get('actor')! : 'maya';
const company = actor !== 'alex';
const quest = { state, actor, now, backend: { kind: 'local', supports: {} }, dispatch: () => { throw Error('Review must not dispatch'); } } as unknown as Quest;
function Review() {
  const [opened, setOpened] = useState('');
  const [tab, setTab] = useState<AwarenessTab>('inbox');
  const noop = () => {};
  const onOpen = (id: string) => setOpened(`Opened task: ${state.tasks.find(task => task.id === id)?.title}`);
  if (params.get('view') === 'notifications') {
    const count = [4, 11, 101].includes(Number(params.get('count'))) ? Number(params.get('count')) : 4;
    const width = [232, PANEL_DEFAULT, 304, 420].includes(Number(params.get('width'))) ? Number(params.get('width')) : PANEL_DEFAULT;
    const control = { tab, setTab, isMobile: false, read: new Set(), snoozes: [], markRead: noop, afterNavigate: noop } as unknown as SidebarControl;
    return <div className="shell" style={{ '--context-offset': `${width}px` } as CSSProperties}>
      <main className="main">Synthetic notification count review: {count}. No operational records are written.</main>
      <div className="notification-edge"><NotificationDrawer quest={quest} control={control} open inbox={{ items: [], unread: count, sources: [], byWorkspace: [] }}
        attention={{ items: [], mine: count, snoozed: 0 }} threadAllowed={() => true}
        onClose={noop} onOpenTask={onOpen} onOpenLead={noop} onOpenInbox={noop} onOpenAttention={noop} onOpenActivity={noop} /></div>
    </div>;
  }
  return <main style={{ padding: 16 }}>
    <p>Synthetic B03 component review · {actor}</p>
    <output aria-live="polite">{opened}</output>
    {params.get('view') === 'projects' ? <CompanyWork quest={quest} onOpen={onOpen} /> :
      <Home quest={quest} company={company} canCreate={company} canDeck={false}
        onOpen={onOpen} onOpenLead={id => setOpened(`Opened lead: ${id}`)} onCreate={() => setOpened('Create task')}
        onRegistry={noop} onDeck={noop} onTeam={noop} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Review />);
