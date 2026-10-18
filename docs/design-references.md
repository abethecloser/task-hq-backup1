# Design references — Task-HQ

Approved outside references. We **borrow interaction details only**: no new styling framework, no replacement components, and no dependencies unless one is approved separately. Everything is rebuilt in Task-HQ's own CSS tokens (`src/ui/quest.css`, `src/ui/behavior.css`) and its white-on-white, behavior-colored system.

**Gate:** nothing here is implemented until the first real task persistence test passes: Abraham creates a task in Quest Roofing, refreshes, and it's still there, with the save confirmed on the server.

---

## Aceternity UI — Sidebar (`sidebar-demo`)

- **Source:** https://ui.aceternity.com/registry/sidebar-demo.json (Tailwind v4, shadcn, `motion`, `@tabler/icons-react`)
- **Decision (2026-10-17):** adapt only, option 1. Keep our existing sidebar, navigation and CSS. Don't install Tailwind, shadcn, `motion` or the Tabler icons.
- **What to borrow:** floating depth, fluid expansion, refined spacing and subtle motion.

Planned refinements to the existing sidebar (`.sidebar` in `src/ui/quest.css`, `src/app/Sidebar.tsx`):

| Quality | Today | Refinement |
|---|---|---|
| Floating depth | Full-height rail flush to the edge, with a right border and a single 44px shadow when expanded | Expanded panel floats: inset 8px from the viewport edges, with a 14px radius and no hard border. Two layered soft shadows: a tight contact shadow plus a wide ambient one, both low opacity. The rail itself stays flat. |
| Fluid expansion | `width` transition at 200ms, `cubic-bezier(.2,.8,.2,1)` | Same timing tokens, with a slightly springier ease-out on open and a quicker close. The shadow and radius grow with the width, so the panel appears to lift rather than slide. |
| Refined spacing | 4px gaps, 14/8/12 padding | 8px rhythm. Icons stay on a fixed 40px column so they never shift when labels appear, and the label column starts at the same x every time. |
| Subtle motion | Labels fade in and slide 6px | Labels fade in over ~120ms with a 4px slide and a short stagger by row (capped). The active item's highlight glides between rows instead of jumping. |

Rules that stay as they are:
- Collapsed on every load, 150ms close delay, click to pin for the session, Escape closes, mobile menu, and full keyboard and screen-reader behavior.
- `prefers-reduced-motion` turns off the stagger and glide and keeps instant state changes.
- Colors follow the behavioral palette. The floating surface is white on white; depth comes from shadow, not tint.

## Cult UI — Wizard Expandable

- **Source:** https://www.cult-ui.com/docs/components/wizard-expandable
- **Decision (2026-10-17):** an optional, reusable interaction pattern. It is never a mandatory flow and must not add onboarding steps.
- **Preserve:** expandable motion, per-step validation, keyboard accessibility and the compact interaction model.
- **Candidate uses:**
  - organization onboarding (Platform console)
  - member invitations (Members & access)
  - advanced task creation ("More options")
  - authorized Stop the Line activation (after Stop the Line exists)
- **Adapt to:** the white-on-white surfaces, the behavioral palette (blue progress, amber assist, green completion, red for Stop the Line and restrictions), and the existing Latch and Switch controls.
