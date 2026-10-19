import { useMemo } from 'react';
import { companySignals } from '../core/company-signals.ts';
import { DropdownDetails } from '../ui/useDropdown.tsx';
import type { Quest } from '../ui/useQuest.ts';

export function CompanySignals({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor, now } = quest;
  const feed = useMemo(() => companySignals(state, actor, now), [state, actor, now]);
  const preview = feed.items.find(item => item.source === 'event') ?? feed.items[0];
  return <section className="company-signals" aria-label="Company Signals">
    <DropdownDetails>
      <summary><strong>{state.workspace.name}</strong><span>{feed.summary}</span></summary>
      <ul aria-label="Operational signals">
        {feed.items.map(item => <li key={item.id}>
          <button type="button" onClick={() => onOpen(item.taskId)}>
            <small>{item.source === 'event' ? 'Recorded change' : 'Current condition'}{item.at !== undefined && <> · <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></>}</small>
            <span>{item.text}</span><small>{item.detail}</small>
          </button>
        </li>)}
        {!feed.items.length && <li className="signals-empty">No current task alerts or recorded changes in the last 24 hours.</li>}
      </ul>
    </DropdownDetails>
    {preview && <button type="button" className="company-signal-preview" onClick={() => onOpen(preview.taskId)} title={preview.detail}>{preview.text}</button>}
  </section>;
}
