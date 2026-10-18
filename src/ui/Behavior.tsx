// Behavioral controls: color belongs to what the control does, not decoration.
//   progress (blue)  · complete (green latch) · assist (amber) · stop (red) · neutral (graphite)
// Each control has resting, hover, active, loading, success, error and disabled states,
// works by pointer, touch and keyboard, and announces outcomes to assistive tech.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { feedbackSound } from './sound.ts';

export type BehaviorTone = 'progress' | 'complete' | 'assist' | 'stop' | 'neutral';
type Phase = 'rest' | 'press' | 'loading' | 'success' | 'error';

const SUCCESS_MS = 900;
const DRAG_COMMIT = 0.7;

/** Tone for a forward-moving action label (Move Work Forward and situation offers). */
export function toneForAction(label: string, capability?: string): BehaviorTone {
  if (capability === 'task.resolve' || /blocker resolved|sorted|unblock/i.test(label)) return 'assist';
  if (capability === 'undo') return 'neutral';
  if (/^(complete|approve)/i.test(label)) return 'complete';
  return 'progress';
}

/**
 * Latch: a pill with a sliding thumb. Press (or tap) commits immediately; dragging
 * the thumb past 70% also commits. The fill sweeps in the behavior color while the
 * action runs, then latches to success or snaps back on failure.
 */
export function Latch({ label, tone, onCommit, disabled = false, disabledLabel, successLabel = 'Done', size = 'lg', hint, stopPropagation = false }: {
  label: string;
  tone: BehaviorTone;
  /** Resolve true when the authoritative engine accepted the action. */
  onCommit: () => Promise<boolean>;
  disabled?: boolean;
  disabledLabel?: string;
  successLabel?: string;
  size?: 'lg' | 'md' | 'sm';
  hint?: string;
  stopPropagation?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('rest');
  const [drag, setDrag] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const track = useRef<HTMLButtonElement>(null);
  const start = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function commit() {
    if (disabled || phase === 'loading' || phase === 'success') return;
    setPhase('loading');
    feedbackSound('press');
    let ok = false;
    try { ok = await onCommit(); } catch { ok = false; }
    if (!alive.current) return;
    setDrag(null);
    if (ok) {
      setPhase('success'); setAnnounce(`${label}: ${successLabel}`); feedbackSound('success');
      setTimeout(() => { if (alive.current) setPhase('rest'); }, SUCCESS_MS);
    } else {
      setPhase('error'); setAnnounce(`${label} was not applied`); feedbackSound('error');
      setTimeout(() => { if (alive.current) setPhase('rest'); }, 420);
    }
  }

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || phase === 'loading' || phase === 'success') return;
    if (stopPropagation) event.stopPropagation();
    const box = track.current!.getBoundingClientRect();
    start.current = { x: event.clientX, width: box.width, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPhase('press');
  }
  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!start.current) return;
    const delta = event.clientX - start.current.x;
    if (Math.abs(delta) > 6) start.current.moved = true;
    if (start.current.moved) setDrag(Math.max(0, Math.min(1, delta / (start.current.width * 0.85))));
  }
  function up() {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (s.moved) {
      suppressClick.current = true;
      if ((drag ?? 0) >= DRAG_COMMIT) void commit();
      else { setDrag(null); setPhase('rest'); }
    } else if (phase === 'press') setPhase('rest');
  }
  function key(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (stopPropagation) event.stopPropagation(); void commit(); }
  }

  const fill = phase === 'loading' || phase === 'success' ? 1 : drag ?? (phase === 'press' ? 0.12 : 0);
  const shown = disabled ? disabledLabel ?? label : phase === 'success' ? successLabel : label;
  return (
    <span className={`latch latch-${size} tone-${tone} is-${disabled ? 'disabled' : phase} ${drag !== null ? 'is-dragging' : ''}`} style={{ ['--fill' as string]: fill }}>
      <button ref={track} type="button" className="latch-track" disabled={disabled} aria-disabled={disabled} aria-busy={phase === 'loading'} title={hint}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        onClick={event => { if (stopPropagation) event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } void commit(); }}>
        <span className="latch-fill" aria-hidden="true" />
        <span className="latch-label">{shown}</span>
        <span className="latch-thumb" aria-hidden="true">
          {phase === 'loading' ? <span className="latch-spinner" /> : phase === 'success' ? <CheckGlyph /> : disabled ? <LockGlyph /> : <ArrowGlyph />}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
    </span>
  );
}

/** Switch: a sliding toggle with an explicit on/off label. */
export function Switch({ checked, onChange, label, tone = 'progress', disabled = false, describedBy }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; tone?: BehaviorTone; disabled?: boolean; describedBy?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-describedby={describedBy} disabled={disabled}
      className={`hq-switch tone-${tone} ${checked ? 'is-on' : ''}`} onClick={() => { feedbackSound('press'); onChange(!checked); }}>
      <span className="hq-switch-track" aria-hidden="true"><span className="hq-switch-knob" /></span>
      <span className="hq-switch-label">{label}</span>
      <span className="hq-switch-state" aria-hidden="true">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

const ArrowGlyph = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
const CheckGlyph = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const LockGlyph = () => <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="2" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></svg>;
