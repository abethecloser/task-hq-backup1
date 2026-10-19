import { forwardRef, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import './dropdown.css';
import { useDropdown } from './useDropdown.tsx';

/** Retains the native select, options, form value, styling and React change handler.
 * Only the transient option surface is shared; persistent list selects stay native. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(props, forwarded) {
  const input = useRef<HTMLSelectElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 260, transform: 'none' });
  const id = useId();
  const [choices, setChoices] = useState<{ label: string; disabled: boolean; hidden: boolean; selected: boolean; group: string }[]>([]);
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    const next = [...input.current.options].map(option => ({ label: option.label, disabled: option.disabled || !!option.closest('optgroup')?.disabled,
      hidden: !!option.hidden, selected: option.selected, group: option.closest('optgroup')?.label ?? '' }));
    setChoices(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, [open, props.children, props.value, props.multiple]);
  const persistent = (props.size ?? 0) > 1;
  useDropdown({ open, onClose: () => setOpen(false), trigger: () => input.current, content: () => popup.current });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = input.current!.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 12, above = rect.top - 12, up = below < 180 && above > below;
      const width = Math.min(Math.max(rect.width, 160), innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top: up ? rect.top - 4 : rect.bottom + 4,
        width, maxHeight: Math.max(80, Math.min(260, up ? above : below)), transform: up ? 'translateY(-100%)' : 'none' });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useLayoutEffect(() => { if (open) popup.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active]);
  const disabled = (option: { disabled: boolean; hidden: unknown }) => option.disabled || !!option.hidden;
  const show = () => { if (props.disabled || persistent) return; setActive(Math.max(0, input.current?.selectedIndex ?? 0)); setOpen(true); };
  function pick(index: number) {
    const element = input.current, option = element?.options[index];
    if (!element || !option || disabled(option) || !!option.closest('optgroup')?.disabled) return;
    if (!props.multiple && element.selectedIndex === index) { setOpen(false); return; }
    if (props.multiple) option.selected = !option.selected;
    else element.selectedIndex = index;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (!props.multiple) setOpen(false);
  }
  return <>
    <select {...props} ref={element => { input.current = element; if (typeof forwarded === 'function') forwarded(element); else if (forwarded) forwarded.current = element; }}
      aria-expanded={persistent ? undefined : open} aria-controls={open ? id : undefined} aria-activedescendant={open && choices[active] ? `${id}-${active}` : undefined}
      onPointerDown={event => { props.onPointerDown?.(event); if (!persistent && !event.defaultPrevented) { event.preventDefault(); event.currentTarget.focus(); } }}
      onClick={event => { props.onClick?.(event); if (!persistent && !event.defaultPrevented) { if (open) setOpen(false); else show(); } }}
      onKeyDown={event => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented || persistent || props.disabled) return;
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (open) pick(active); else show(); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!open) { show(); return; }
          const delta = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
          let next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : active + delta;
          while (choices[next] && disabled(choices[next]!)) next += delta;
          if (choices[next]) setActive(next);
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
          event.preventDefault(); if (!open) show();
          const next = choices.findIndex(option => !disabled(option) && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
          if (next >= 0) setActive(next);
        }
      }} />
    {open && createPortal(<div ref={popup} className="hq-select-menu" style={position}>
      <div id={id} role="listbox" aria-label={props['aria-label'] ?? input.current?.labels?.[0]?.textContent ?? 'Options'} aria-multiselectable={props.multiple || undefined}>
        {choices.map((option, index) => !option.hidden && <button key={index} id={`${id}-${index}`} data-index={index} type="button" role="option" tabIndex={-1}
          disabled={disabled(option)} aria-selected={option.selected} className={index === active ? 'is-active' : ''}
          onPointerDown={event => event.preventDefault()} onClick={() => pick(index)}>{option.group ? `${option.group} · ` : ''}{option.label}</button>)}
      </div>
    </div>, document.body)}
  </>;
});
