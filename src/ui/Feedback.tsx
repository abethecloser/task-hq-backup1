import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DropdownDetails } from './useDropdown.tsx';
import { FEEDBACK, feedbackPolicy } from '../core/feedback.ts';
import type { FeedbackCue } from '../core/feedback.ts';
import type { Quest } from './useQuest.ts';
import { audioArmed, feedbackCueSound, useSoundPreference } from './sound.ts';
const Context = createContext<Quest['feedback'] | null>(null);
export function FeedbackProvider({ feedback, children }: { feedback: Quest['feedback']; children: ReactNode }) { return <Context.Provider value={feedback}>{children}</Context.Provider>; }
export function feedbackAttributes(cue?: FeedbackCue) {
  return cue ? { 'data-feedback': cue.signature, 'data-feedback-phase': cue.phase, 'data-feedback-motion': FEEDBACK[cue.signature].motion, 'aria-busy': cue.phase === 'processing' || cue.phase === 'acknowledged' } : {};
}
export function useFeedbackRecord(id?: string) { const feedback = useContext(Context); return id ? feedbackAttributes(feedback?.record(id)) : {}; }
export function RecordCue({ id }: { id: string }) { const f = useContext(Context), cue = f?.record(id); return cue ? <small className="record-cue" key={cue.id} data-feedback={cue.signature}>{cue.phase === 'processing' || cue.phase === 'acknowledged' ? 'Saving…' : `${cue.passive ? 'Incoming · ' : ''}${FEEDBACK[cue.signature].label}`}</small> : null; }
export function FeedbackBar({ quest, children }: { quest: Quest; children?: ReactNode }) {
  const { cue } = quest.feedback;
  const [sound, setSound] = useSoundPreference();
  const [haptics, setHaptics] = useState(false);
  const played = useRef(new Set<string>()), lastAudio = useRef(0);
  const def = cue ? FEEDBACK[cue.signature] : null;
  useEffect(() => {
    if (!cue || !['confirmed', 'denied', 'failed', 'attention', 'reversed', 'incoming'].includes(cue.phase) || played.current.has(cue.id)) return;
    played.current.add(cue.id);
    if (played.current.size > 300) played.current.delete(played.current.values().next().value!);
    if (cue.passive && !FEEDBACK[cue.signature].urgent) return;
    if (Date.now() - lastAudio.current < 600) return;
    lastAudio.current = Date.now();
    const policy = feedbackPolicy(cue, { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, muted: !sound, audioArmed: audioArmed(), haptics });
    if (policy.audio) feedbackCueSound(cue.signature);
    if (policy.haptic && typeof navigator.vibrate === 'function') navigator.vibrate(FEEDBACK[cue.signature].urgent ? [30, 40, 30] : 18);
  }, [cue, haptics, sound]);
  const pending = cue?.phase === 'processing' || cue?.phase === 'acknowledged';
  const undo = quest.toast?.undoId && cue?.id === quest.toast.undoId ? quest.toast.undoId : null;
  return <section className={`feedback-bar ${cue ? 'has-result' : ''}`} {...feedbackAttributes(cue ?? undefined)} aria-label="Operational feedback">
    {children}
    {cue && <div className="feedback-result" key={cue?.id ?? 'ready'}>
      <span className="feedback-symbol" aria-hidden="true">{pending ? '◌' : def?.icon ?? '·'}</span>
      <div><strong>{pending ? cue?.phase === 'acknowledged' ? 'Action received' : 'Checking and saving' : cue ? `${cue.passive ? 'Incoming · ' : ''}${def?.label}${cue.count > 1 ? ` · ${cue.count}` : ''}` : ''}</strong>
        {cue && <span className="feedback-detail" title={cue.text}>{cue.text}</span>}
      </div>
      <span className="sr-only" role={cue?.phase === 'denied' || cue?.phase === 'failed' ? 'alert' : 'status'} aria-live={cue?.phase === 'denied' || cue?.phase === 'failed' ? 'assertive' : 'polite'}>{cue ? `${cue.phase}. ${cue.text}` : ''}</span>
    </div>}
    <div className="feedback-controls">
      {undo && <button type="button" className="btn btn-sm" onClick={() => void quest.dispatch({ type: 'undo', eventId: undo })}>Undo ↶</button>}
      {cue && !pending && <button type="button" className="icon-btn" aria-label="Dismiss operational feedback" onClick={quest.feedback.dismiss}>×</button>}
      <DropdownDetails><summary aria-label="Sensory feedback preferences">Feedback</summary><div className="feedback-preferences"><label><input type="checkbox" checked={sound} onChange={e => setSound(e.target.checked)} />Event tones</label><label><input type="checkbox" checked={haptics} disabled={typeof navigator.vibrate !== 'function'} onChange={e => setHaptics(e.target.checked)} />Haptics {typeof navigator.vibrate !== 'function' && '(unavailable)'}</label><small>Audio starts only after your interaction. System reduced-motion settings are respected.</small></div></DropdownDetails>
    </div>
  </section>;
}
