// Task-HQ sign-in, recreated from the approved "Sign in — Quest Task-HQ"
// reference (split panel, ember gradient, white form panel). Real Supabase Auth
// calls; when no backend is configured the forms still validate and say so.
import { useEffect, useState } from 'react';
import brandMark from '../assets/brand/mark.png';
import type { FormEvent, ReactNode } from 'react';
import { backendConfigured, redirectUrl, supabase } from './client.ts';
import './auth.css';

export type AuthView = 'sign-in' | 'magic' | 'sign-up' | 'forgot' | 'reset' | 'request';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first — check your inbox for the link.';
  if (/already registered|already been registered/i.test(message)) return 'An account with that email already exists. Sign in instead.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'Choose a stronger password (at least 8 characters).';
  return message;
}

const NOT_CONNECTED = 'Sign-in isn’t connected yet. This build has no Task-HQ backend, so accounts can’t be created or verified here.';

export function AuthScreen({ view, go, onDemo }: { view: AuthView; go: (view: AuthView) => void; onDemo: () => void }) {
  return (
    <div className="auth-page">
      <main className="auth-card">
        <section className="auth-art">
          <span className="auth-chip auth-chip-brand"><Glyph /> TASK-HQ</span>
          <span className="auth-chip auth-chip-theme"><RefreshIcon /> EMBER</span>
          <div className="auth-pitch">
            <h1><span>Task-HQ.</span><span className="dim">Tasks, time and approvals</span><span>in one place.</span></h1>
            <p>The operations board for teams that move work forward.<br />Access is limited to what your role permits.</p>
          </div>
        </section>
        <section className="auth-panel">
          <div className="auth-icon" aria-hidden="true"><Glyph /></div>
          <div className="auth-form-wrap" key={view}>
            {view === 'sign-in' && <SignIn go={go} />}
            {view === 'magic' && <MagicLink go={go} />}
            {view === 'sign-up' && <SignUp go={go} />}
            {view === 'forgot' && <Forgot go={go} />}
            {view === 'reset' && <Reset go={go} />}
            {view === 'request' && <RequestAccess go={go} />}
            <p className="auth-foot">Access is limited to what your role permits.</p>
            <button type="button" className="auth-demo" onClick={onDemo}>Explore the Task-HQ Demo</button>
          </div>
        </section>
      </main>
    </div>
  );
}

// ── Shared form pieces ─────────────────────────────────────────────────────

type Errors = Record<string, string>;

function useForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ title: string; text: string } | null>(null);
  async function submit(event: FormEvent, validate: () => Errors, run: (client: NonNullable<ReturnType<typeof supabase>>) => Promise<void>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length) return;
    const client = supabase();
    if (!client || !backendConfigured) { setNotice({ tone: 'info', text: NOT_CONNECTED }); return; }
    setBusy(true);
    try { await run(client); } catch (reason) { setNotice({ tone: 'error', text: friendly(reason instanceof Error ? reason.message : 'Something went wrong. Try again.') }); }
    setBusy(false);
  }
  return { errors, notice, busy, sent, setSent, submit };
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="auth-heading"><h2>{title}</h2><p>{subtitle}</p></header>;
}

function Field({ id, label, type = 'text', value, onChange, placeholder, error, autoComplete, hint }: {
  id: string; label: string; type?: string; value: string; onChange: (value: string) => void; placeholder: string; error?: string; autoComplete?: string; hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className={`auth-field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label} <span aria-hidden="true">*</span></label>
      <div className="auth-input">
        <input id={id} name={id} type={isPassword && shown ? 'text' : type} value={value} placeholder={placeholder} autoComplete={autoComplete} required aria-required="true"
          aria-invalid={!!error} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} onChange={event => onChange(event.target.value)} />
        {isPassword && (
          <button type="button" className="auth-eye" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {error ? <p className="auth-error" id={`${id}-error`}>{error}</p> : hint ? <p className="auth-hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

function Notice({ notice }: { notice: { tone: 'error' | 'info'; text: string } | null }) {
  if (!notice) return null;
  return <p className={`auth-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>;
}

function Sent({ sent, go }: { sent: { title: string; text: string }; go: (view: AuthView) => void }) {
  return (
    <>
      <Heading title={sent.title} subtitle={sent.text} />
      <button type="button" className="auth-primary" onClick={() => go('sign-in')}>Back to sign in</button>
    </>
  );
}

const emailError = (value: string) => (!value.trim() ? 'Enter your email.' : !EMAIL.test(value.trim()) ? 'Enter a valid email address.' : '');

// ── Views ──────────────────────────────────────────────────────────────────

function SignIn({ go }: { go: (view: AuthView) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useForm();
  return (
    <form noValidate onSubmit={event => void form.submit(event,
      () => { const e: Errors = {}; const m = emailError(email); if (m) e.email = m; if (!password) e.password = 'Enter your password.'; return e; },
      async client => { const { error } = await client.auth.signInWithPassword({ email: email.trim(), password }); if (error) throw error; })}>
      <Heading title="Welcome back" subtitle="Sign in to continue." />
      <button type="button" className="auth-secondary" onClick={() => go('magic')}><MailIcon /> Sign in with Magic Link</button>
      <div className="auth-divider"><span>Or</span></div>
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Enter your email" autoComplete="email" error={form.errors.email} />
      <Field id="password" label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" error={form.errors.password} />
      <Notice notice={form.notice} />
      <button className="auth-primary" disabled={form.busy}>{form.busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="auth-links">
        <span>Don't have an account? <button type="button" onClick={() => go('sign-up')}>Sign up</button></span>
        <button type="button" onClick={() => go('forgot')}>Forgot password?</button>
      </div>
    </form>
  );
}

function MagicLink({ go }: { go: (view: AuthView) => void }) {
  const [email, setEmail] = useState('');
  const form = useForm();
  if (form.sent) return <Sent sent={form.sent} go={go} />;
  return (
    <form noValidate onSubmit={event => void form.submit(event,
      (): Errors => { const m = emailError(email); return m ? { email: m } : {}; },
      async client => {
        const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: redirectUrl('#/') } });
        if (error) throw error;
        form.setSent({ title: 'Check your email', text: `If ${email.trim()} has an account, a one-time sign-in link is on its way.` });
      })}>
      <Heading title="Sign in with Magic Link" subtitle="We’ll email you a one-time sign-in link." />
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Enter your email" autoComplete="email" error={form.errors.email} />
      <Notice notice={form.notice} />
      <button className="auth-primary" disabled={form.busy}>{form.busy ? 'Sending…' : 'Send magic link'}</button>
      <div className="auth-links"><button type="button" onClick={() => go('sign-in')}>Back to sign in</button></div>
    </form>
  );
}

function SignUp({ go }: { go: (view: AuthView) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useForm();
  if (form.sent) return <Sent sent={form.sent} go={go} />;
  return (
    <form noValidate onSubmit={event => void form.submit(event,
      () => { const e: Errors = {}; if (!name.trim()) e.name = 'Enter your name.'; const m = emailError(email); if (m) e.email = m; if (password.length < 8) e.password = 'Use at least 8 characters.'; return e; },
      async client => {
        const { error } = await client.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() }, emailRedirectTo: redirectUrl('#/') } });
        if (error) throw error;
        form.setSent({ title: 'Confirm your email', text: `We sent a confirmation link to ${email.trim()}. Open it to finish creating your account.` });
      })}>
      <Heading title="Create your account" subtitle="Start with your work email." />
      <Field id="name" label="Full name" value={name} onChange={setName} placeholder="Enter your name" autoComplete="name" error={form.errors.name} />
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Enter your email" autoComplete="email" error={form.errors.email} />
      <Field id="password" label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" error={form.errors.password} />
      <Notice notice={form.notice} />
      <button className="auth-primary" disabled={form.busy}>{form.busy ? 'Creating account…' : 'Create account'}</button>
      <div className="auth-links">
        <span>Have an account? <button type="button" onClick={() => go('sign-in')}>Sign in</button></span>
        <button type="button" onClick={() => go('request')}>Request access</button>
      </div>
    </form>
  );
}

function Forgot({ go }: { go: (view: AuthView) => void }) {
  const [email, setEmail] = useState('');
  const form = useForm();
  if (form.sent) return <Sent sent={form.sent} go={go} />;
  return (
    <form noValidate onSubmit={event => void form.submit(event,
      (): Errors => { const m = emailError(email); return m ? { email: m } : {}; },
      async client => {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl('#/auth/reset') });
        if (error) throw error;
        form.setSent({ title: 'Check your email', text: `If ${email.trim()} has an account, a password reset link is on its way.` });
      })}>
      <Heading title="Reset your password" subtitle="We’ll email you a link to choose a new one." />
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Enter your email" autoComplete="email" error={form.errors.email} />
      <Notice notice={form.notice} />
      <button className="auth-primary" disabled={form.busy}>{form.busy ? 'Sending…' : 'Send reset link'}</button>
      <div className="auth-links"><button type="button" onClick={() => go('sign-in')}>Back to sign in</button></div>
    </form>
  );
}

function Reset({ go }: { go: (view: AuthView) => void }) {
  const [password, setPassword] = useState('');
  const form = useForm();
  if (form.sent) return <Sent sent={form.sent} go={go} />;
  return (
    <form noValidate onSubmit={event => void form.submit(event,
      (): Errors => (password.length < 8 ? { password: 'Use at least 8 characters.' } : {}),
      async client => {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        form.setSent({ title: 'Password updated', text: 'You can sign in with your new password.' });
      })}>
      <Heading title="Choose a new password" subtitle="Use at least 8 characters." />
      <Field id="password" label="New password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" error={form.errors.password} />
      <Notice notice={form.notice} />
      <button className="auth-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Update password'}</button>
      <div className="auth-links"><button type="button" onClick={() => go('sign-in')}>Back to sign in</button></div>
    </form>
  );
}

function RequestAccess({ go }: { go: (view: AuthView) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [password, setPassword] = useState('');
  const form = useForm();
  if (form.sent) return <Sent sent={form.sent} go={go} />;
  return (
    <form noValidate onSubmit={event => void form.submit(event,
      () => { const e: Errors = {}; if (!name.trim()) e.name = 'Enter your name.'; const m = emailError(email); if (m) e.email = m; if (!workspace.trim()) e.workspace = 'Enter the workspace you need.'; if (password.length < 8) e.password = 'Use at least 8 characters.'; return e; },
      async client => {
        // The account is created first; the request reaches the workspace's owners only after the email is confirmed.
        const { error } = await client.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim(), requested_workspace: workspace.trim() }, emailRedirectTo: redirectUrl('#/') } });
        if (error) throw error;
        form.setSent({ title: 'Confirm your email', text: `Open the link we sent to ${email.trim()}. Your request then goes to the owners of ${workspace.trim()}.` });
      })}>
      <Heading title="Request access" subtitle="Ask a workspace owner to let you in." />
      <Field id="name" label="Full name" value={name} onChange={setName} placeholder="Enter your name" autoComplete="name" error={form.errors.name} />
      <Field id="email" label="Work email" type="email" value={email} onChange={setEmail} placeholder="Enter your email" autoComplete="email" error={form.errors.email} />
      <Field id="workspace" label="Workspace" value={workspace} onChange={setWorkspace} placeholder="e.g. Quest Roofing" autoComplete="organization" error={form.errors.workspace} />
      <Field id="password" label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" error={form.errors.password} />
      <Notice notice={form.notice} />
      <button className="auth-primary" disabled={form.busy}>{form.busy ? 'Sending request…' : 'Request access'}</button>
      <div className="auth-links"><span>Already have access? <button type="button" onClick={() => go('sign-in')}>Sign in</button></span></div>
    </form>
  );
}

export function useSession() {
  const [state, setState] = useState<{ ready: boolean; email: string | null; recovery: boolean }>({ ready: !backendConfigured, email: null, recovery: false });
  useEffect(() => {
    const client = supabase();
    if (!client) return;
    void client.auth.getSession().then(({ data }) => setState(current => ({ ...current, ready: true, email: data.session?.user.email ?? null })));
    const { data } = client.auth.onAuthStateChange((event, session) => setState({ ready: true, email: session?.user.email ?? null, recovery: event === 'PASSWORD_RECOVERY' }));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
/** Task-HQ glyph: an "H" moving forward. */
export function Glyph() {
  return <img className="auth-glyph" src={brandMark} alt="" aria-hidden="true" draggable={false} />;
}
const MailIcon = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></Svg>;
const EyeIcon = () => <Svg size={18}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></Svg>;
const EyeOffIcon = () => <Svg size={18}><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Svg>;
const RefreshIcon = () => <Svg size={13}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></Svg>;
