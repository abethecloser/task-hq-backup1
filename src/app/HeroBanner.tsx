import * as Popover from '@radix-ui/react-popover';
import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

// The Home banner's background: the default illustration, a color tone, or an uploaded photo.
// Kept per person and workspace on this device (localStorage); a photo is downscaled first so it fits.
// Colors are tokens, not raw hex: each tone carries its own text and highlight color so every
// choice stays legible and on-brand.
export interface Tone { id: string; name: string; bg: string; ink: string; accent: string }

/** The quiet basics. */
export const BASICS: Tone[] = [
  { id: 'mist', name: 'Mist', bg: '#f3f4f6', ink: '#16171a', accent: '#c64b09' },
  { id: 'white', name: 'White', bg: '#ffffff', ink: '#16171a', accent: '#c64b09' },
  { id: 'black', name: 'Black', bg: '#111214', ink: '#ffffff', accent: '#ff9a5c' },
];
/** Editorial, saturated tones. */
export const EDITORIAL: Tone[] = [
  { id: 'ember', name: 'Ember', bg: '#c2410c', ink: '#ffffff', accent: '#ffd8bf' },
  { id: 'saffron', name: 'Saffron', bg: '#f2b134', ink: '#1f1405', accent: '#7c2d12' },
  { id: 'rose', name: 'Rose', bg: '#e11d48', ink: '#ffffff', accent: '#ffd1da' },
  { id: 'plum', name: 'Plum', bg: '#5b21b6', ink: '#ffffff', accent: '#ddd3ff' },
  { id: 'cobalt', name: 'Cobalt', bg: '#1d4ed8', ink: '#ffffff', accent: '#c7dbff' },
  { id: 'lagoon', name: 'Lagoon', bg: '#0e7490', ink: '#ffffff', accent: '#b8f1fb' },
  { id: 'emerald', name: 'Emerald', bg: '#047857', ink: '#ffffff', accent: '#b7f5d8' },
  { id: 'midnight', name: 'Midnight', bg: '#1e293b', ink: '#ffffff', accent: '#fdba74' },
  { id: 'clay', name: 'Clay', bg: '#e7d8c6', ink: '#1c1917', accent: '#9a3412' },
  { id: 'lime', name: 'Lime', bg: '#d9f99d', ink: '#1a2e05', accent: '#3f6212' },
];
const TONES = [...BASICS, ...EDITORIAL];

export type Banner = { kind: 'default' } | { kind: 'tone'; id: string } | { kind: 'photo'; src: string; x?: number; y?: number }
  /** Saved by an earlier version; shown as the nearest look. */ | { kind: 'color'; color: string };

const key = (tenant: string, actor: string) => `quest.banner.${tenant}.${actor}`;

function read(storageKey: string): Banner {
  try { const raw = localStorage.getItem(storageKey); return raw ? JSON.parse(raw) as Banner : { kind: 'default' }; } catch { return { kind: 'default' }; }
}

/** Relative luminance under .5 means light text reads better on top. */
export function isDark(hex: string) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) return false;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

export function useBanner(tenant: string, actor: string) {
  const storageKey = key(tenant, actor);
  const [banner, setBanner] = useState<Banner>(() => read(storageKey));
  const [error, setError] = useState('');
  /** True while a photo is being positioned (after upload, or from Reposition). */
  const [adjusting, setAdjusting] = useState(false);
  const save = (next: Banner) => {
    try {
      if (next.kind === 'default') localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, JSON.stringify(next));
      setBanner(next); setError(''); return true;
    } catch { setError('That photo is too large to keep on this device. Try a smaller one.'); return false; }
  };
  return { banner, save, error, adjusting, setAdjusting };
}

function toneOf(banner: Banner): Tone | null {
  if (banner.kind === 'tone') return TONES.find(tone => tone.id === banner.id) ?? null;
  if (banner.kind === 'color') return TONES.find(tone => tone.bg === banner.color)
    ?? { id: 'legacy', name: '', bg: banner.color, ink: isDark(banner.color) ? '#ffffff' : '#16171a', accent: isDark(banner.color) ? '#ffd8bf' : '#c64b09' };
  return null;
}

/** Style and class for the hero element. */
export function bannerLook(banner: Banner): { className: string; style?: CSSProperties } {
  const tone = toneOf(banner);
  if (tone) {
    const shade = tone.ink === '#ffffff' ? '#000' : '#fff';
    return { className: `has-banner has-tone ${tone.ink === '#ffffff' ? 'is-dark' : ''}`, style: {
      background: `linear-gradient(115deg, ${tone.bg} 45%, color-mix(in srgb, ${tone.bg} 82%, ${shade}) 100%)`,
      ['--banner-ink' as string]: tone.ink, ['--banner-accent' as string]: tone.accent,
    } };
  }
  if (banner.kind === 'photo') return { className: 'has-banner has-photo', style: {
    backgroundImage: `linear-gradient(90deg, rgb(255 255 255 / 94%) 0%, rgb(255 255 255 / 80%) 38%, rgb(255 255 255 / 0%) 70%), url(${banner.src})`,
    backgroundPosition: `0 0, ${banner.x ?? 50}% ${banner.y ?? 50}%`,
  } };
  return { className: '' };
}

function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / image.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    image.src = url;
  });
}

export function BannerEditor({ banner, save, error, setAdjusting }: ReturnType<typeof useBanner>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const current = toneOf(banner)?.id ?? '';
  async function upload(chosen: File | undefined) {
    if (!chosen) return;
    setBusy(true); setReadError('');
    try { if (save({ kind: 'photo', src: await downscale(chosen), x: 50, y: 50 })) { setOpen(false); setAdjusting(true); } }
    catch { setReadError('That file could not be read as an image.'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  }
  const swatch = (tone: Tone) => <button key={tone.id} type="button" className={`hd-swatch ${current === tone.id ? 'is-on' : ''}`} style={{ background: tone.bg }}
    aria-label={tone.name} title={tone.name} aria-pressed={current === tone.id} onClick={() => save({ kind: 'tone', id: tone.id })} />;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="hd-banner-edit">
        <Popover.Trigger className="hd-banner-btn" aria-label="Customize banner">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></svg><span>Customize</span>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content className="hd-banner-panel" side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label="Customize banner">
          <p className="hd-banner-label">Basics</p>
          <div className="hd-banner-swatches">{BASICS.map(swatch)}</div>
          <p className="hd-banner-label">Editorial</p>
          <div className="hd-banner-swatches is-grid">{EDITORIAL.map(swatch)}</div>
          <p className="hd-banner-label">Photo</p>
          <div className="hd-banner-row">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Preparing…' : banner.kind === 'photo' ? 'Replace photo' : 'Upload photo'}</button>
            {banner.kind === 'photo' && <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); setAdjusting(true); }}>Reposition</button>}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={event => void upload(event.target.files?.[0])} />
          {(error || readError) && <p className="hd-banner-error" role="alert">{error || readError}</p>}
          {banner.kind !== 'default' && <button type="button" className="link hd-banner-reset" onClick={() => save({ kind: 'default' })}>Reset to default</button>}
          <p className="hd-banner-note">Saved on this device for you.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Drag the photo (or use the arrow keys) to choose what shows, then Save or Cancel. */
export function BannerAdjust({ banner, save, setAdjusting }: ReturnType<typeof useBanner>) {
  const photo = banner.kind === 'photo' ? banner : null;
  const [pos, setPos] = useState({ x: photo?.x ?? 50, y: photo?.y ?? 50 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  if (!photo) return null;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const down = (event: PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, px: pos.x, py: pos.y }; };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current; if (!start) return;
    const box = event.currentTarget.getBoundingClientRect();
    // Dragging right reveals more of the left side, as when moving a photo in a frame.
    setPos({ x: clamp(start.px - ((event.clientX - start.x) / box.width) * 100), y: clamp(start.py - ((event.clientY - start.y) / box.height) * 100) });
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (delta) { event.preventDefault(); setPos(current => ({ x: clamp(current.x + delta[0]!), y: clamp(current.y + delta[1]!) })); }
    if (event.key === 'Enter') { event.preventDefault(); if (save({ ...photo, ...pos })) setAdjusting(false); }
    if (event.key === 'Escape') { event.preventDefault(); setAdjusting(false); }
  };
  return (
    <div className="hd-adjust" style={{ backgroundImage: `url(${photo.src})`, backgroundPosition: `${pos.x}% ${pos.y}%` }}
      role="slider" tabIndex={0} aria-label="Photo position. Drag or use the arrow keys, Enter to save, Escape to cancel."
      aria-valuetext={`${Math.round(pos.x)}% across, ${Math.round(pos.y)}% down`} autoFocus
      onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onKeyDown={key}>
      <span className="hd-adjust-hint">Drag to position</span>
      <span className="hd-adjust-actions" onPointerDown={event => event.stopPropagation()}>
        <button type="button" className="btn btn-sm" onClick={() => setAdjusting(false)}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { if (save({ ...photo, ...pos })) setAdjusting(false); }}>Save</button>
      </span>
    </div>
  );
}
