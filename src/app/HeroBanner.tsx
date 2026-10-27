import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useDropdown } from '../ui/useDropdown.tsx';

// The Home banner's background: the default illustration, a solid color, or an uploaded photo.
// Kept per person and workspace on this device (localStorage); a photo is downscaled first so it fits.
export type Banner = { kind: 'default' } | { kind: 'color'; color: string } | { kind: 'photo'; src: string };

const SWATCHES = ['#f3f4f6', '#c64b09', '#1f2937', '#1e3a5f', '#2f5d50', '#e9dcc9'];
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
  const save = (next: Banner) => {
    try {
      if (next.kind === 'default') localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, JSON.stringify(next));
      setBanner(next); setError('');
    } catch { setError('That photo is too large to keep on this device. Try a smaller one.'); }
  };
  return { banner, save, error };
}

/** Style and class for the hero element. */
export function bannerLook(banner: Banner): { className: string; style?: CSSProperties } {
  if (banner.kind === 'color') return { className: `has-banner ${isDark(banner.color) ? 'is-dark' : ''}`, style: { background: banner.color } };
  if (banner.kind === 'photo') return { className: 'has-banner has-photo', style: { backgroundImage: `linear-gradient(90deg, rgb(255 255 255 / 94%) 0%, rgb(255 255 255 / 80%) 38%, rgb(255 255 255 / 0%) 70%), url(${banner.src})` } };
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

export function BannerEditor({ banner, save, error }: ReturnType<typeof useBanner>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useDropdown({ open, onClose: () => setOpen(false), trigger: () => button.current, content: () => panel.current, region: () => root.current });
  // The banner clips its overflow, so the panel is placed in the viewport, under the button.
  const [at, setAt] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    const place = () => { const r = button.current?.getBoundingClientRect(); if (r) setAt({ position: 'fixed', top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right), bottom: 'auto' }); };
    place();
    const close = () => setOpen(false);
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  const current = banner.kind === 'color' ? banner.color : '';
  async function upload(chosen: File | undefined) {
    if (!chosen) return;
    setBusy(true); setReadError('');
    try { save({ kind: 'photo', src: await downscale(chosen) }); }
    catch { setReadError('That file could not be read as an image.'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  }
  return (
    <div className="hd-banner-edit" ref={root}>
      <button ref={button} type="button" className="hd-banner-btn" aria-label="Customize banner" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></svg><span>Customize</span>
      </button>
      {open && <div ref={panel} className="hd-banner-panel" role="dialog" aria-label="Customize banner" style={at}>
        <p className="hd-banner-label">Color</p>
        <div className="hd-banner-swatches">
          {SWATCHES.map(color => <button key={color} type="button" className={`hd-swatch ${current === color ? 'is-on' : ''}`} style={{ background: color }} aria-label={`Use color ${color}`} aria-pressed={current === color} onClick={() => save({ kind: 'color', color })} />)}
          <label className="hd-swatch hd-swatch-custom" title="Pick any color"><span className="sr-only">Pick any color</span>
            <input type="color" value={current || '#c64b09'} onChange={event => save({ kind: 'color', color: event.target.value })} />
          </label>
        </div>
        <p className="hd-banner-label">Photo</p>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Preparing…' : banner.kind === 'photo' ? 'Replace photo' : 'Upload photo'}</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={event => void upload(event.target.files?.[0])} />
        {(error || readError) && <p className="hd-banner-error" role="alert">{error || readError}</p>}
        {banner.kind !== 'default' && <button type="button" className="link hd-banner-reset" onClick={() => save({ kind: 'default' })}>Reset to default</button>}
        <p className="hd-banner-note">Saved on this device for you.</p>
      </div>}
    </div>
  );
}
