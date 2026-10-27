// First: take a badge code out of the address bar before anything else reads or logs it.
import { LANDING_BADGE } from './auth/badge.ts';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { AuthScreen, useSession } from './auth/AuthScreen.tsx';
import { BadgeCheckIn } from './auth/BadgeCheckIn.tsx';
import { LiveRoot } from './live/LiveRoot.tsx';
import type { AuthView } from './auth/AuthScreen.tsx';
import { supabase } from './auth/client.ts';
import { isExtensionContext } from './adapter/store.ts';
import { entryMode, saveMode } from './auth/mode.ts';
import { PRODUCT } from './core/workspace.ts';
import './ui/quest.css';
import './ui/nexus.css';
import './ui/studio.css';
import './ui/feedback.css';
import './ui/home.css';
import './ui/brutalist.css';
import './ui/shell.css';
import { applyLook } from './ui/look.ts';

// Entry: real sign-in by default on the web; the synthetic demo is a separate,
// explicit mode with its own local data. The extension stays demo-only for now.
const AUTH_VIEWS: AuthView[] = ['sign-in', 'magic', 'sign-up', 'forgot', 'reset', 'set-password', 'request'];

function readMode(): 'demo' | 'auth' {
  return entryMode(location.href, isExtensionContext(), !!LANDING_BADGE);
}

function authViewFromHash(): AuthView {
  const [, first, second] = location.hash.split('/');
  return first === 'auth' && AUTH_VIEWS.includes(second as AuthView) ? second as AuthView : 'sign-in';
}

function Root() {
  const [mode, setMode] = useState(readMode);
  const [view, setView] = useState<AuthView>(authViewFromHash);
  const [badge, setBadge] = useState(LANDING_BADGE);
  const [badgeSignIn, setBadgeSignIn] = useState(false);
  const session = useSession();

  useEffect(() => {
    const onHash = () => {
      setView(authViewFromHash());
      if (!isExtensionContext() && location.hash.startsWith('#/auth/')) { saveMode('auth'); setMode('auth'); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { if (session.recovery) { saveMode('auth'); setMode('auth'); setView('reset'); } }, [session.recovery]);
  // Signed in by magic link: offer (once, skippable) to set a password for next time.
  useEffect(() => { if (session.offerPassword) { saveMode('auth'); setMode('auth'); history.replaceState(null, '', '#/auth/set-password'); setView('set-password'); } }, [session.offerPassword]);
  // An email link that couldn't be used lands on the page it chose (sign-in or forgot), with its notice.
  useEffect(() => { if (session.notice) setView(authViewFromHash()); }, [session.notice]);
  useEffect(() => {
    if (mode !== 'demo' || isExtensionContext()) return;
    const url = new URL(location.href);
    if (url.searchParams.has('demo') || /^\/demo\/?$/.test(url.pathname) || url.hash === '#/demo') {
      url.searchParams.delete('demo');
      url.pathname = '/';
      url.hash = '#/home';
      history.replaceState(null, '', url);
    }
  }, [mode]);
  useEffect(() => { document.title = mode === 'demo' ? PRODUCT.demo : `Sign in — ${PRODUCT.name}`; }, [mode]);

  function enterDemo() {
    saveMode('demo');
    history.replaceState(null, '', '#/home');
    setMode('demo');
  }
  function exitDemo() {
    saveMode('auth');
    history.replaceState(null, '', '#/auth/sign-in');
    setView('sign-in');
    setMode('auth');
  }
  function go(next: AuthView) {
    history.replaceState(null, '', `#/auth/${next}`);
    setView(next);
  }

  const client = supabase();
  // A badge scan: the person signs in with their own account (the badge is kept in memory only),
  // the server confirms that account owns the badge, then the workday gate takes SOD and check-in.
  if (badge && mode !== 'demo') {
    if (!session.ready) return null;
    if (session.email || !badgeSignIn) {
      return <BadgeCheckIn code={badge} email={session.email} onContinue={() => { setBadge(null); history.replaceState(null, '', '#/home'); }}
        onSignIn={() => { setBadgeSignIn(true); go('sign-in'); }} onCancel={() => setBadge(null)}
        onSwitch={() => { setBadgeSignIn(true); go('sign-in'); void client?.auth.signOut({ scope: 'local' }); }} />;
    }
    return <AuthScreen view={view} go={go} onDemo={enterDemo} notice={session.notice} />;
  }
  if (mode === 'demo') return <App onExitDemo={isExtensionContext() ? undefined : exitDemo} />;
  if (!session.ready) return null;
  if (session.email && client && view !== 'reset' && view !== 'set-password') {
    return <LiveRoot key={session.email} client={client} onSignOut={() => { history.replaceState(null, '', '#/auth/sign-in'); void client.auth.signOut({ scope: 'local' }); }} onDemo={enterDemo} />;
  }
  return <AuthScreen view={view} go={go} onDemo={enterDemo} notice={session.notice} />;
}

applyLook();
createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
