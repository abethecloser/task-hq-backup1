// The screen a badge scan opens: check in (or out) on this phone and sign in, with no email or
// password. A new phone waits for an Owner or Admin's approval and signs no one in.
import { useEffect, useRef, useState } from 'react';
import { supabase } from './client.ts';
import { deviceKey } from './badge.ts';
import { Glyph } from './AuthScreen.tsx';

type Outcome =
  | { state: 'working' }
  | { state: 'ok'; kind: 'in' | 'out'; at: string; name: string; note: string }
  | { state: 'device-pending'; name: string }
  | { state: 'error'; text: string };

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function BadgeCheckIn({ code, onDone }: { code: string; onDone: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>({ state: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // one scan per page load, even if effects run twice
    started.current = true;
    const client = supabase();
    if (!client) { setOutcome({ state: 'error', text: 'Check-in isn’t connected in this build.' }); return; }
    void (async () => {
      const { data, error } = await client.functions.invoke('badge-check-in', { body: { code, device: deviceKey() } });
      // Errors from the function arrive as an HTTP response; network failures don't.
      const response = error && 'context' in error ? (error.context as Partial<Response> | undefined) : undefined;
      const body = (data ?? (typeof response?.json === 'function' ? await response.json().catch(() => null) : null)) as
        { status?: string; kind?: 'in' | 'out'; at?: string; name?: string; note?: string; token_hash?: string; error?: string } | null;
      if (body?.status === 'device-pending') { setOutcome({ state: 'device-pending', name: body.name ?? '' }); return; }
      if (body?.status !== 'ok' || !body.token_hash) { setOutcome({ state: 'error', text: body?.error ?? 'Check-in couldn’t complete. Try scanning again.' }); return; }
      const signed = await client.auth.verifyOtp({ token_hash: body.token_hash, type: 'magiclink' });
      if (signed.error) { setOutcome({ state: 'error', text: 'You’re checked in, but signing in didn’t finish. Scan again to open your work.' }); return; }
      setOutcome({ state: 'ok', kind: body.kind ?? 'in', at: body.at ?? new Date().toISOString(), name: body.name ?? '', note: body.note ?? '' });
    })().catch(() => setOutcome({ state: 'error', text: 'Check-in couldn’t reach Task-HQ. Check your connection and scan again.' }));
  }, [code]);

  const first = (name: string) => (name ? `, ${name.split(' ')[0]}` : '');
  let title = 'Checking you in…', text = 'One moment.';
  if (outcome.state === 'ok') {
    title = outcome.kind === 'in' ? `Checked in${first(outcome.name)}` : `Checked out${first(outcome.name)}`;
    text = `${clock(outcome.at)} · waiting for an Owner or Admin to confirm.${outcome.note ? ` ${outcome.note}.` : ''}`;
  } else if (outcome.state === 'device-pending') {
    title = 'New phone';
    text = 'This badge belongs to another phone. We asked an Owner or Admin to approve this one. Scan again once they have.';
  } else if (outcome.state === 'error') {
    title = 'Check-in didn’t go through';
    text = outcome.text;
  }
  return (
    <div className="auth-page">
      <main className="auth-card is-single">
        <section className="auth-panel">
          <div className="auth-icon" aria-hidden="true"><Glyph /></div>
          <div className="auth-form-wrap" role="status" aria-live="polite">
            <header className="auth-heading"><h2>{title}</h2><p>{text}</p></header>
            {outcome.state === 'ok' && <button type="button" className="auth-primary" autoFocus onClick={onDone}>{outcome.kind === 'in' ? 'Open my work' : 'Done'}</button>}
            {outcome.state !== 'ok' && outcome.state !== 'working' && <button type="button" className="auth-demo" onClick={onDone}>Go to sign in</button>}
          </div>
        </section>
      </main>
    </div>
  );
}
