import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Quest } from '../ui/useQuest.ts';
import { paletteItems, rankPalette } from '../core/palette.ts';
import type { PaletteItem } from '../core/palette.ts';

/** ⌘K / Ctrl+K: find a task, jump to a page or start a new one without leaving the keyboard.
 * It navigates through the same hash routes as the links, so permissions and page guards are unchanged. */
export function CommandPalette({ quest, onCreate }: { quest: Quest; onCreate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(was => { if (!was) opener.current = document.activeElement as HTMLElement | null; return !was; });
        setText(''); setActive(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const all = useMemo(
    () => open ? paletteItems(quest.state, quest.actor, quest.now, { canOpenPage: page => page !== 'team' }).filter(item => item.target.kind !== 'create' || !!onCreate) : [],
    [open, quest.state, quest.actor, Math.floor(quest.now / 60000), onCreate],
  );
  const shown = useMemo(() => rankPalette(all, text), [all, text]);

  const close = () => { setOpen(false); opener.current?.focus?.(); };
  const run = (item: PaletteItem) => {
    setOpen(false);
    const { target } = item;
    if (target.kind === 'create') onCreate?.();
    else location.hash = target.kind === 'page' ? `#/${target.page}` : `#/task/${encodeURIComponent(target.id)}`;
  };
  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (event.key === 'Enter' && shown[active]) { event.preventDefault(); run(shown[active]!); }
  };

  if (!open) return null;
  let lastGroup = '';
  return createPortal(
    <div className="cmdk-scrim" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <input ref={input} className="cmdk-input" value={text} placeholder="Find a task, go to a page, or start something…" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={shown[active] ? `cmdk-${active}` : undefined} aria-label="Search commands"
          onChange={event => { setText(event.target.value); setActive(0); }} onKeyDown={onInputKey} />
        <ul id="cmdk-list" className="cmdk-list" role="listbox">
          {shown.length === 0 && <li className="cmdk-empty">Nothing matches “{text}”.</li>}
          {shown.map((item, index) => {
            const heading = item.group !== lastGroup ? item.group : '';
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {heading && <div className="cmdk-group">{heading}</div>}
                <div id={`cmdk-${index}`} role="option" aria-selected={index === active} className={`cmdk-row ${index === active ? 'is-active' : ''}`} onMouseMove={() => setActive(index)} onClick={() => run(item)}>
                  <span className="cmdk-label">{item.label}</span><span className="cmdk-hint">{item.hint}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="cmdk-foot"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>
      </div>
    </div>,
    document.body,
  );
}
