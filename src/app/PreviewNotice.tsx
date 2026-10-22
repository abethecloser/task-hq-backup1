export const PREVIEW_VIEWS: readonly string[] = ['tools', 'leads', 'relationships'];

interface Notice { operational: string; notConnected: string; persistence: string }

const LIVE: Record<string, Notice> = {
  tools: {
    operational: 'Nothing on this page is operational in your workspace yet.',
    notConnected: 'Takeoff, underwriting, pricing and proposals are not connected. No estimate or proposal can be created or sent.',
    persistence: 'Nothing here is saved. The Demo shows these tools with sample data on that device only.',
  },
  leads: {
    operational: 'You can see the workspace lead list and how a response would be tracked.',
    notConnected: 'No lead source is connected, so real inquiries do not arrive here. Task-HQ never calls, texts or emails anyone.',
    persistence: 'Do not use this page as a record of customer follow-up yet.',
  },
  relationships: {
    operational: 'You can browse the contact records that the First Response list holds.',
    notConnected: 'No lead source is connected, so the list is empty until one is approved. Contact tools and outreach are not available.',
    persistence: 'Do not use this page as a customer record yet.',
  },
};

const DEMO: Notice = {
  operational: 'This is the Demo: every record here is synthetic.',
  notConnected: 'No real customers, messages or integrations are connected.',
  persistence: 'Changes stay in this browser on this device only.',
};

export function PreviewNotice({ view, live }: { view: string; live: boolean }) {
  const notice = live ? LIVE[view] : DEMO;
  if (!notice) return null;
  return (
    <aside className="preview-notice" role="note" aria-label="Preview page">
      <strong>Preview</strong>
      <ul>
        <li><b>Working:</b> {notice.operational}</li>
        <li><b>Not connected:</b> {notice.notConnected}</li>
        <li><b>Saved:</b> {notice.persistence}</li>
      </ul>
    </aside>
  );
}

const RESTRICTED_COPY = {
  role: 'This page is for owners, admins and supervisors. Your account does not have access to it. Nothing on it has been changed or shown.',
  unavailable: 'This page is not available yet. It keeps its place here and will open when it is ready. Nothing on it has been changed or shown.',
} as const;

export function RestrictedPage({ label, reason, onHome }: { label: string; reason: 'role' | 'unavailable'; onHome: () => void }) {
  return (
    <div className="view restricted-page">
      <header className="view-head">
        <div>
          <p className="eyebrow">{reason === 'role' ? 'Restricted' : 'Unavailable'}</p>
          <h1>{label}</h1>
          <p className="lede">{RESTRICTED_COPY[reason]}</p>
        </div>
      </header>
      <button type="button" className="btn" onClick={onHome}>Back to Home</button>
    </div>
  );
}
