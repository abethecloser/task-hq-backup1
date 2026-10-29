import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { drawerFocusController } from './drawer-focus.ts';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Shared edge panel. Keeping it mounted preserves local drafts and scroll. */
export function EdgeDrawer({ open, label, id, className = '', onClose, children, modal = true }: {
  open: boolean; label: string; id?: string; className?: string; onClose: () => void; children: ReactNode;
  /** False when the panel is docked beside the page (desktop): no focus trap, so the header and page stay
   * reachable; Escape closes it only from inside, and focus returns to its launcher. */
  modal?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = panel.current;
    if (!open || !node || modal) return;
    const launchers = () => id ? [...document.querySelectorAll<HTMLElement>('[aria-controls]')].filter(el => el.getAttribute('aria-controls') === id) : [];
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fromLauncher = !!previous && launchers().includes(previous);
    // Opened from its own button: move focus in, as a keyboard user expects. Otherwise leave focus where it is.
    const first = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].find(el => !el.closest('[inert], [hidden]') && el.getClientRects().length > 0);
    let frame = 0, tries = 0;
    // focus() is ignored while the panel is still visibility:hidden at the start of its slide, so retry until it lands.
    const enter = () => { const target = first(); target?.focus({ preventScroll: true }); if (document.activeElement !== target && tries++ < 60) frame = requestAnimationFrame(enter); };
    if (fromLauncher) frame = requestAnimationFrame(enter);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); } };
    node.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('keydown', key);
      const target = (fromLauncher ? previous : null) ?? launchers()[0];
      if (node.contains(document.activeElement) && target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    };
  }, [open, id, modal]);
  useEffect(() => {
    const node = panel.current;
    if (!open || !node || !modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const launcher = id ? [...document.querySelectorAll<HTMLElement>('[aria-controls]')].find(el => el.getAttribute('aria-controls') === id) : null;
    const returnTo = previous && previous !== document.body && !previous.closest('.edge-drawer') ? previous : launcher;
    const items = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el =>
      !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible');
    const focus = drawerFocusController({
      active: () => document.activeElement as HTMLElement | null,
      contains: el => !!el && node.contains(el), items, panel: node,
      initial: () => items().find(el => el.hasAttribute('data-drawer-autofocus')),
      focus: el => {
        el.focus({ preventScroll: true });
        // Reveal a wrapped Tab target within the panel, without scrolling the workspace.
        const scroller = el.closest<HTMLElement>('.context-body, .ask-log');
        if (scroller && node.contains(scroller)) {
          const bounds = scroller.getBoundingClientRect(), target = el.getBoundingClientRect();
          if (target.top < bounds.top) scroller.scrollTop -= bounds.top - target.top + 4;
          else if (target.bottom > bounds.bottom) scroller.scrollTop += target.bottom - bounds.bottom + 4;
        }
      }, close: () => close.current(),
      restore: () => {
        const target = returnTo?.isConnected && !returnTo.closest('[inert]') ? returnTo : launcher;
        if (!document.querySelector('.edge-drawer.is-open:not([inert])') && target?.isConnected && !target.closest('[inert]')) {
          target.focus({ preventScroll: true });
        }
      },
    });
    const key = (event: KeyboardEvent) => focus.key(event);
    const reenter = () => focus.enter();
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', reenter);
    node.addEventListener('transitionend', reenter);
    // Opening a conversation removes the focused notification row without firing focusin.
    const content = new MutationObserver(reenter);
    content.observe(node, { childList: true, subtree: true });
    focus.enter();
    return () => {
      content.disconnect();
      focus.dispose();
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', reenter);
      node.removeEventListener('transitionend', reenter);
    };
  }, [open, id, modal]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const fit = () => panel.current?.style.setProperty('--vvh', `${Math.round(viewport.height)}px`);
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => { viewport.removeEventListener('resize', fit); viewport.removeEventListener('scroll', fit); };
  }, []);
  return <aside id={id} ref={panel} tabIndex={-1} className={`edge-drawer ${className} ${open ? 'is-open' : 'is-closed'}`} inert={!open} aria-hidden={!open} role="complementary" aria-label={label}>{children}</aside>;
}
