/** Shared transient-menu policy. Host-provided timers make the timing deterministic in tests. */
export function dropdownController(close: () => void, protectedFocus: () => boolean, timers = {
  set: (callback: () => void) => setTimeout(callback, 250),
  clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outside = false;
  const cancel = () => { if (timer !== undefined) timers.clear(timer); timer = undefined; };
  const leave = () => {
    outside = true;
    if (timer !== undefined || protectedFocus()) return;
    timer = timers.set(() => { timer = undefined; if (outside && !protectedFocus()) close(); });
  };
  return {
    leave,
    pointerMove: (inside: boolean, pointerType: string) => { if (pointerType !== 'mouse') return; if (inside) { outside = false; cancel(); } else leave(); },
    enter: () => { outside = false; cancel(); },
    focusChanged: () => { if (protectedFocus()) cancel(); else if (outside) leave(); },
    dismiss: () => { cancel(); close(); },
    dispose: cancel,
  };
}
