// Optional, user-controlled feedback sounds. Off by default. Synthesized with
// Web Audio (no files, no network). Remembered per browser profile.
import { FEEDBACK } from '../core/feedback.ts';
import type { FeedbackSignature } from '../core/feedback.ts';
import { useEffect, useState } from 'react';

const KEY = 'tmhq.sound';
const listeners = new Set<(on: boolean) => void>();
let context: AudioContext | null = null;
let armed = false;
function arm() { try { context ??= new AudioContext(); void context.resume(); armed = true; } catch { armed = false; } }

export function audioArmed() { return armed && context?.state === 'running'; }

export function soundEnabled() {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export function setSoundEnabled(on: boolean) {
  if (on) arm(); else armed = false;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* session only */ }
  listeners.forEach(listener => listener(on));
}

export function useSoundPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(soundEnabled);
  useEffect(() => { listeners.add(setOn); return () => { listeners.delete(setOn); }; }, []);
  return [on, setSoundEnabled];
}

/** A short, quiet mechanical cue: press (tick), success (two-note latch), error (low thud). */
export function feedbackSound(kind: 'press' | 'success' | 'error') {
  if (!soundEnabled()) return;
  if (kind === 'press') arm();
  if (!armed) return;
  try {
    context ??= new AudioContext();
    const now = context.currentTime;
    const notes = kind === 'press' ? [[1400, 0, .025]] : kind === 'success' ? [[880, 0, .06], [1320, .07, .09]] : [[180, 0, .12]];
    for (const [freq, at, length] of notes) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = kind === 'error' ? 'triangle' : 'sine';
      osc.frequency.value = freq!;
      gain.gain.setValueAtTime(0.0001, now + at!);
      gain.gain.exponentialRampToValueAtTime(kind === 'press' ? 0.05 : 0.08, now + at! + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at! + length!);
      osc.connect(gain).connect(context.destination);
      osc.start(now + at!);
      osc.stop(now + at! + length! + 0.02);
    }
  } catch { /* audio unavailable: silent */ }
}

/** Authoritative event signatures use the central mapping; never arm from passive effects. */
export function feedbackCueSound(signature: FeedbackSignature) {
  if (!soundEnabled() || !armed || !context || context.state !== 'running') return;
  try {
    const start = context.currentTime;
    FEEDBACK[signature].notes.forEach((frequency, i) => {
      const osc = context!.createOscillator(), gain = context!.createGain();
      osc.type = FEEDBACK[signature].urgent ? 'triangle' : 'sine'; osc.frequency.value = frequency;
      const at = start + i * .065; gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.045, at + .008); gain.gain.exponentialRampToValueAtTime(.0001, at + .07);
      osc.connect(gain).connect(context!.destination); osc.start(at); osc.stop(at + .085);
    });
  } catch { /* Visual and textual feedback remain authoritative. */ }
}
