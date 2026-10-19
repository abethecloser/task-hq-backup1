import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { AuthScreen, useSession } from './auth/AuthScreen.tsx';
import { LiveRoot } from './live/LiveRoot.tsx';
import type { AuthView } from './auth/AuthScreen.tsx';
import { supabase } from './auth/client.ts';
import { isExtensionContext } from './adapter/store.ts';
import { PRODUCT } from './core/workspace.ts';
import './ui/quest.css';
import './ui/nexus.css';
import './ui/studio.css';
import './ui/feedback.css';
import './ui/home.css';
import './ui/brutalist.css';
import { applyLook } from './ui/look.ts';

// Entry: real sign-in by default on the web; the synthetic demo is a separate,
// explicit mode with its own local data. The extension stays demo-only for now.
const MODE_KEY = 'tmhq.mode';
const AUTH_VIEWS: AuthView[] = ['sign-in', 'magic', 'sign-up', 'forgot', 'reset', 'request'];

function readMode(): 'demo' | 'auth' {
  if (isExtensionContext()) return 'demo';
  try { return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'auth'; } catch { return 'auth'; }
}

function authViewFromHash(): AuthView {
  const [, first, second] = location.hash.split('/');
  return first === 'auth' && AUTH_VIEWS.includes(second as AuthView) ? second as AuthView : 'sign-in';
}

function Root() {
  const [mode, setMode] = useState(readMode);
  const [view, setView] = useState<AuthView>(authViewFromHash);
  const session = useSession();

  useEffect(() => {
    const onHash = () => setView(authViewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { if (session.recovery) setView('reset'); }, [session.recovery]);
  // An email link that couldn't be used lands on the page it chose (sign-in or forgot), with its notice.
  useEffect(() => { if (session.notice) setView(authViewFromHash()); }, [session.notice]);
  useEffect(() => { document.title = mode === 'demo' ? PRODUCT.demo : `Sign in — ${PRODUCT.name}`; }, [mode]);

  function enterDemo() {
    try { localStorage.setItem(MODE_KEY, 'demo'); } catch { /* demo for this tab only */ }
    history.replaceState(null, '', '#/home');
    setMode('demo');
  }
  function exitDemo() {
    try { localStorage.removeItem(MODE_KEY); } catch { /* ignore */ }
    history.replaceState(null, '', '#/auth/sign-in');
    setView('sign-in');
    setMode('auth');
  }
  function go(next: AuthView) {
    history.replaceState(null, '', `#/auth/${next}`);
    setView(next);
  }

  if (mode === 'demo') return <App onExitDemo={isExtensionContext() ? undefined : exitDemo} />;
  if (!session.ready) return null;
  const client = supabase();
  if (session.email && client && view !== 'reset') {
    return <LiveRoot key={session.email} client={client} onSignOut={() => { history.replaceState(null, '', '#/auth/sign-in'); void client.auth.signOut(); }} onDemo={enterDemo} />;
  }
  return <AuthScreen view={view} go={go} onDemo={enterDemo} notice={session.notice} />;
}

applyLook();
createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
