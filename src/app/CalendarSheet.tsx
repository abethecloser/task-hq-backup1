import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

// The bottom edge holds time: the calendar quick view rises as a sheet. Radix Dialog supplies
// focus trapping, Escape and focus return; Motion supplies the spring and drag-to-close.
export function CalendarSheet({ open, onOpenChange, dueToday, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; dueToday: number; children: ReactNode;
}) {
  const drag = useDragControls();
  const reduce = useReducedMotion();
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 38 };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button type="button" className="sheet-handle" aria-label={`Open calendar${dueToday ? `, ${dueToday} due today` : ''}`}>
          <span className="sheet-grip" aria-hidden="true" />
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" /></svg>
          <span>Calendar</span>
          {dueToday > 0 && <b>{dueToday} due today</b>}
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div className="sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring}
                drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.7 }}
                onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onOpenChange(false); }}>
                <div className="sheet-head" onPointerDown={event => drag.start(event)}>
                  <span className="sheet-grip" aria-hidden="true" />
                  <Dialog.Title className="sheet-title">Calendar</Dialog.Title>
                  <Dialog.Close className="ctl" aria-label="Close calendar">
                    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </Dialog.Close>
                </div>
                <div className="sheet-body">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
