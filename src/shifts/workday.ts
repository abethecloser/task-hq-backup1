// Entry rule for the workday gate. Authentication, attendance and authorization stay separate:
// signing in, opening a task or reading work never clocks anyone in, and anyone signed in may
// view the work their role allows while off-shift. Only an explicit check-in starts a shift.

/** 'work' opens the app; 'gate' shows the SOD / check-in page first. */
export function entryPhase({ open, lateEodDue, viewingOffShift }: { open: boolean; lateEodDue: boolean; viewingOffShift: boolean }): 'work' | 'gate' {
  if (open && !lateEodDue) return 'work';
  return viewingOffShift ? 'work' : 'gate';
}
