// The screen a badge scan opens. A badge proves who is at this phone; it never signs anyone in,
// never switches accounts and records no attendance by itself. The person signs in with their
// own account first; the server then checks that account owns the badge (badge-check-in). A
// verified badge continues to SOD and check-in, where the shift (the attendance record) starts.
// A new phone waits for an Owner or Admin's approval.
import { useEffect, useRef, useState } from 'react';
import { supabase } from './client.ts';
import { deviceKey } from './badge.ts';
import { Glyph } from './AuthScreen.tsx';

type Outcome =
  | { state: 'working' }
  | { state: 'verified'; name: string }
  | { state: 'device-pending' }
  | { state: 'mismatch' }
  | { state: 'sign-in' }
  | { state: 'error'; text: string };

/** `email` is the signed-in account, or null when nobody is signed in on this browser. */
export function BadgeCheckIn({ code, email, onContinue, onSignIn, onSwitch, onCancel }: {
  code: string; email: string | null; onContinue: () => void; onSignIn: () => void; onSwitch: () => void; onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>(email ? { state: 'working' } : { state: 'sign-in' });
  const checked = useRef<string | null>(null);

  useEffect(() => {
    if (!email || checked.current === email) return; // one check per signed-in account, even if effects run twice
    checked.current = email;
    setOutcome({ state: 'working' });
    const client = supabase();
    if (!client) { setOutcome({ state: 'error', text: 'Check-in isn’t connected in this build.' }); return; }
    void (async () => {
      // functions.invoke sends this browser's own session; the server verifies it.
      const { data, error } = await client.functions.invoke('badge-check-in', { body: { code, device: deviceKey() } });
      // Errors from the function arrive as an HTTP response; network failures don't.
      const response = error && 'context' in error ? (error.context as Partial<Response> | undefined) : undefined;
      const body = (data ?? (typeof response?.json === 'function' ? await response.json().catch(() => null) : null)) as { status?: string; name?: string; error?: string } | null;
      if (body?.status === 'verified') setOutcome({ state: 'verified', name: body.name ?? '' });
      else if (body?.status === 'account-mismatch') setOutcome({ state: 'mismatch' });
      else if (body?.status === 'sign-in-required') setOutcome({ state: 'sign-in' });
      else if (body?.status === 'device-pending') setOutcome({ state: 'device-pending' });
      else setOutcome({ state: 'error', text: body?.error ?? 'Check-in couldn’t complete. Try scanning again.' });
    })().catch(() => setOutcome({ state: 'error', text: 'Check-in couldn’t reach Task-HQ. Check your connection and scan again.' }));
  }, [code, email]);

  const first = (name: string) => (name ? `, ${name.split(' ')[0]}` : '');
  let title = 'Checking your badge…', text = 'One moment.';
  let actions = <></>;
  if (outcome.state === 'verified') {
    title = `Badge confirmed${first(outcome.name)}`;
    text = 'Next: a short start-of-day note, then your shift starts and My Work opens.';
    actions = <button type="button" className="auth-primary" autoFocus onClick={onContinue}>Start my day</button>;
  } else if (outcome.state === 'sign-in') {
    title = 'Sign in to check in';
    text = 'Your badge doesn’t sign you in. Sign in with your own account on this phone, and your check-in continues from here.';
    actions = <><button type="button" className="auth-primary" autoFocus onClick={onSignIn}>Sign in</button><button type="button" className="auth-demo" onClick={onCancel}>Cancel</button></>;
  } else if (outcome.state === 'mismatch') {
    title = 'This badge is for someone else';
    text = `This phone is signed in as ${email}, which isn’t the badge’s account. Nothing was recorded. To check in, sign out and sign in as the badge’s owner.`;
    actions = <><button type="button" className="auth-primary" autoFocus onClick={onSwitch}>Sign out and switch account</button><button type="button" className="auth-demo" onClick={onCancel}>Stay signed in as {email}</button></>;
  } else if (outcome.state === 'device-pending') {
    title = 'New phone';
    text = 'This badge is linked to another phone. We asked an Owner or Admin to approve this one. Scan again once they have.';
    actions = <button type="button" className="auth-demo" onClick={onCancel}>Continue without the badge</button>;
  } else if (outcome.state === 'error') {
    title = 'Check-in didn’t go through';
    text = outcome.text;
    actions = <button type="button" className="auth-demo" onClick={onCancel}>Continue</button>;
  }
  return (
    <div className="auth-page">
      <main className="auth-card is-single">
        <section className="auth-panel">
          <div className="auth-icon" aria-hidden="true"><Glyph /></div>
          <div className="auth-form-wrap" role="status" aria-live="polite">
            <header className="auth-heading"><h2>{title}</h2><p>{text}</p></header>
            {actions}
          </div>
        </section>
      </main>
    </div>
  );
}
