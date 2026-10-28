/** Keyboard policy shared by the two edge drawers. The host supplies DOM and
 * animation frames so opening before visibility settles is testable. */
export function drawerFocusController<T>(host: {
  active: () => T | null; contains: (node: T | null) => boolean; items: () => T[];
  initial?: () => T | undefined; panel: T; focus: (node: T) => void; close: () => void; restore?: () => void;
}, frames = {
  request: (fn: () => void) => requestAnimationFrame(fn),
  cancel: (id: number) => cancelAnimationFrame(id),
}) {
  let frame: number | undefined, disposed = false, attempts = 0;
  const enter = () => {
    if (disposed || (host.contains(host.active()) && host.active() !== host.panel)) return;
    host.focus(host.initial?.() ?? host.items()[0] ?? host.panel);
    if ((!host.contains(host.active()) || (host.active() === host.panel && !host.items().length)) && attempts++ < 30) frame = frames.request(enter);
  };
  return {
    enter,
    key(event: { key: string; shiftKey: boolean; preventDefault: () => void; stopImmediatePropagation: () => void }) {
      if (disposed) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); host.close();
      } else if (event.key === 'Tab') {
        const items = host.items(), active = host.active();
        if (!items.length || !host.contains(active) || (event.shiftKey ? active === items[0] : active === items.at(-1))) {
          event.preventDefault(); event.stopImmediatePropagation();
          host.focus((event.shiftKey ? items.at(-1) : items[0]) ?? host.panel);
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) frames.cancel(frame);
      host.restore?.();
    },
  };
}
