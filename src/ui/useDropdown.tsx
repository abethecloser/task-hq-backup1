import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DetailsHTMLAttributes } from 'react';
import { dropdownController } from './dropdown-controller.ts';

interface DropdownOptions {
  open: boolean;
  onClose: () => void;
  trigger: () => HTMLElement | null | undefined;
  content: () => HTMLElement | null | undefined;
  region?: () => HTMLElement | null | undefined;
}
let active: { dismiss: () => void } | undefined;
let inputMode: 'pointer' | 'keyboard' = 'pointer';
let hosts = 0;
const pointerMode = () => { inputMode = 'pointer'; };
const keyboardMode = () => { inputMode = 'keyboard'; };

/** One policy for inline and portaled transient surfaces. Persistent panels do not opt in. */
export function useDropdown(options: DropdownOptions) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    if (hosts++ === 0) { document.addEventListener('pointerdown', pointerMode, true); document.addEventListener('keydown', keyboardMode, true); }
    return () => { if (--hosts === 0) { document.removeEventListener('pointerdown', pointerMode, true); document.removeEventListener('keydown', keyboardMode, true); } };
  }, []);
  useEffect(() => {
    if (!options.open) return;
    let keyboard = inputMode === 'keyboard';
    const contains = (element: HTMLElement | null | undefined, target: EventTarget | null) => target instanceof Node && !!element?.contains(target);
    const inside = (target: EventTarget | null) => [latest.current.trigger(), latest.current.content(), latest.current.region?.()].some(element => contains(element, target));
    const policy = dropdownController(() => latest.current.onClose(), () => {
      const focus = document.activeElement;
      const search = focus instanceof HTMLElement && (focus.matches('input, textarea, [contenteditable="true"]'));
      return contains(latest.current.content(), focus) || (inside(focus) && (keyboard || search));
    });
    active?.dismiss();
    const entry = { dismiss: policy.dismiss };
    active = entry;
    const move = (event: PointerEvent) => {
      policy.pointerMove(inside(event.target), event.pointerType);
    };
    const exit = (event: PointerEvent) => { if (event.pointerType === 'mouse' && !event.relatedTarget) policy.leave(); };
    const down = (event: PointerEvent) => { keyboard = false; if (!inside(event.target)) policy.dismiss(); else policy.enter(); };
    const key = (event: KeyboardEvent) => {
      keyboard = true;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        // Return focus only when it is leaving the menu, preserving search caret otherwise.
        if (contains(latest.current.content(), document.activeElement)) latest.current.trigger()?.focus();
        policy.dismiss();
      } else policy.focusChanged();
    };
    const focus = () => policy.focusChanged();
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', exit);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focus);
    return () => {
      policy.dispose();
      if (active === entry) active = undefined;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', exit);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focus);
    };
  }, [options.open]);
}

/** Native disclosure styling, with the shared transient interaction policy. */
export function DropdownDetails({ children, ...props }: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useDropdown({ open, onClose: () => setOpen(false), trigger: () => root.current?.querySelector('summary'), content: () => root.current?.querySelector(':scope > :not(summary)'), region: () => root.current });
  return <details {...props} ref={root} open={open} onClick={event => {
    props.onClick?.(event);
    const option = (event.target as HTMLElement).closest('button, a, [role="option"]');
    if (option && !option.closest('summary') && !option.closest('[aria-multiselectable="true"], [data-dropdown-keep-open]')) setOpen(false);
  }} onToggle={event => setOpen(event.currentTarget.open)}>{children}</details>;
}
