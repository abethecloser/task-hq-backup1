# Task-HQ design handoff for a new prototype page

**To the designer (Claude Design):** design one new page for Task-HQ, an operations app for Quest Roofing. It has to look like it already shipped. Don't invent a style: use the attached stylesheet and app shell, and reuse existing classes before writing new CSS.

**Attached:**

| File | What it is |
|---|---|
| `task-hq-studio.css` | The app's real compiled stylesheet. Link it as is. |
| `shell.html` | The real app frame (rail, sidebar, top bar, canvas, optional context zone). Build inside it. |
| `brand-mark.png` | Logo mark used in the rail. |
| Screenshots | Reference for what "fits in" means. Match their density and rhythm. |

---

## 1. Page brief (fill this in before sending)

- **Page name / nav label:**
- **Who uses it:** (owner · manager · crew member · reviewer)
- **The one question this page answers:**
- **Primary action:**
- **What's on it:** (lists, stats, cards, a form, a table…)
- **Where it lives:** new nav item / tab inside an existing view / context-zone panel / modal
- **Width:** standard (max 1120px) or wide (max 1320px)
- **States to show:** empty · normal · lots of data · something needs attention
- **Closest existing page:** (My Work · All Tasks · Executive Desk · Inbox · People & Roles)

---

## 2. Non-negotiables

1. `<html data-look="studio">` must be set, or the Studio palette doesn't apply.
2. Link `task-hq-studio.css` and the Google Fonts tag that's already in `shell.html`. Don't add any other CSS framework: no Tailwind, shadcn, Bootstrap, motion libraries or icon packs.
3. **No new colors.** New rules may only use the `var(--…)` tokens below. Never write a raw hex value.
4. **White on white.** Surfaces are white. Depth comes from hairlines and soft shadows, never tinted backgrounds or large color fills.
5. **Color means action.** Burnt orange is the only accent, and it marks what's active, hot, selected or primary. Red is only for blocked, overdue, stop or restricted states. Nothing is colored for decoration.
6. Light theme only. No dark mode, gradients, illustrations, emoji, serif or italic display type.
7. The markup has to port cleanly into React (`src/app/*.tsx`). Use semantic HTML with plain class names and no inline styles beyond CSS custom properties such as `style="--i: 3"`.

---

## 3. Tokens: the effective Studio values

These are the values in effect after the cascade. They're listed here so you can reason about the design; in code, always reference the variable.

**Surfaces**

| Token | Value | Use |
|---|---|---|
| `--bg` `--canvas` `--panel` `--card` | `#fff` | every surface |
| `--surface-2` / `--sunk` | `#f7f7f7` | table headers, hover rows, inset wells |
| `--surface-3` | `#efefef` | disabled fields |

**Ink**

| Token | Value | Use |
|---|---|---|
| `--ink` | `#111` | titles, primary text, dark buttons, active chips |
| `--ink-2` | `#333` | body text |
| `--muted` | `#595959` | secondary text, micro-labels |
| `--faint` | `#6b6b6b` | meta, timestamps, table column labels |

**Lines**

| Token | Value | Use |
|---|---|---|
| `--hair` | `#e5e5e5` | default card and row borders |
| `--hair-2` | `#c9c9c9` | stronger borders: popovers, segmented controls |
| `--line` / `--line-2` | `#e3e3e3` / `#bdbdbd` | form borders, neutral severity bars |

**Accent (the only brand color)**

| Token | Value | Use |
|---|---|---|
| `--accent` | `#c64b09` | primary button, hot counts, selected-row bar, focus |
| `--accent-ink` | `#a73805` | accent text, links, kickers |
| `--accent-line` | `#cf612d` | accent borders, hover rings |
| `--accent-pale` | `#fafafa` | near-white on purpose: selected rows are **not** tinted orange |

**Status**

| Token | Value | Use |
|---|---|---|
| `--danger` | `#b42318` | blocked, overdue, critical severity |
| `--danger-pale` | `#fdeceb` | background of blocked and overdue pills |
| `--warn` | `#8a5a00` | waiting states |

Drag-to-confirm Latch tones: progress uses `--accent`, assist uses `--attn` (#d97706), complete uses `--ok` (#16a34a), and stop uses `--stop` (#d42a20). They appear only on Latch controls and 8px status dots.

**Shape and depth**

- Radius: `--radius` is 14px for cards, panels and tables. Buttons use 9px, fields 8px (`--field-radius`), pills and chips 999px, modals 16px.
- `--shadow` is the resting card. `--shadow-lift` is for hover and popovers, `--shadow-lg` for modals, drawers and toasts.
- `--active-depth` is the focused composer or active card. `--focus-depth` is the focus ring on fields.
- Control heights: S 30px (`--ctl-s`), M 36px (`--ctl-m`, the default), L 40px (`--ctl-l`). Fields are 38px.

**Motion**

- `--ease-out` is `cubic-bezier(.22, 1, .36, 1)`. Durations run 120–320ms.
- `rise` fades in from 6px below; lists stagger with `animation-delay: calc(var(--i) * 16ms)`, or 50ms for cards.
- `context-in` slides in 16px from the right.
- Everything respects `prefers-reduced-motion`.

---

## 4. Type

The whole app uses Hanken Grotesk. JetBrains Mono is only for row indexes and IDs. Numbers use `font-variant-numeric: tabular-nums`.

| Role | Class / spec |
|---|---|
| Page title | `.view-head h1`: 800, `clamp(34px, 4.4vw, 56px)`, line-height 1, letter-spacing −.04em |
| Eyebrow / micro-label | `.eyebrow`, `.section-label`, `.ctx-label`: 10px, 700, letter-spacing .18em, UPPERCASE, `--muted` |
| Lede | `.lede`: 14.5px, `--muted`, max-width 640px |
| Card title | `.decision-what`: 800, 20px, −.025em · `.panel h3`: 15px, 800 |
| Hero number | `.answer b`: 900, 56px, −.05em · `.home-stat b` / `.measure b`: 800, 26–28px |
| Row title | 14.5px, 700 (`.row-title strong`, `.queue-main strong`) |
| Body | 14px / 1.45 · 12.5–13px inside dense rows |
| Meta | 11.5–12px, `--muted` or `--faint` |
| Table column label | 10px, 700, letter-spacing .14em, UPPERCASE, `--faint` |

---

## 5. Layout: the three zones

| Zone | Size | Notes |
|---|---|---|
| Rail | 56px, fixed left | Icon-only nav. The active item is a lifted white key with accent-ink text. |
| Workspace panel | 248px (resizable), collapsible | Labeled nav with counts. A hot count is an orange pill. |
| Seam toggles | 28px circles | Sit on the boundary between zones and collapse or expand them. |
| Top bar | 60px, sticky, frosted white | Page title · workspace chip · demo flag · right-side controls |
| Content | max 1120px (wide views 1320px), padding 34px 36px 120px | Everything goes inside `.view` (a grid with a 22px gap) |
| Context zone (optional) | 420px for a task, 288px for signals | Right side. The signals panel has a faint 18px grid background. |

**Breakpoints**

| Width | Behavior |
|---|---|
| ≤1280px (sidebar open) | Top bar sheds secondary chips |
| ≤1100px | Three-up stat rows become one column |
| ≤760px | Mobile: seams hidden, h1 36px, context zone becomes a full-width drawer, filters collapse |
| ≤600px | Forms drop to one column |

---

## 6. Components to reuse (class recipes)

**Page frame**

- `.view` › `.view-head` (`.eyebrow` + `h1` + `.lede`, with actions on the right)

**Containers**

- `.panel`: white card with hair border, 14px radius and `--shadow`, padding 18px.
- `.record-card`: base for signal and intake cards.
- `.empty`: a dashed-border empty state with a ✓ mark, h3 and a short sentence.

**Buttons and controls**

- `.btn` is the outline default. Variants: `.btn-primary` (orange), `.btn-dark` (ink), `.btn-ghost`, `.btn-danger`, `.btn-sm`. `.icon-btn` is 34px and icon-only.
- `.chip` / `.chip.is-on` are filter chips; on means an ink fill.
- `.segmented` and `.seg` are small mode switches. `.lens-bar` › `.lens` are view tabs: the active tab is white with a 2px accent underline, and each tab carries a count badge.
- `.latch` is the signature drag-to-confirm control, in `.latch-sm`, `.latch-md` and `.latch-lg` sizes. Use it for consequential "move work forward" actions.
- `.hq-switch` is the on/off toggle.

**Status**

- `.pill` with `.pill-ready`, `.pill-working`, `.pill-blocked`, `.pill-review` or `.pill-done` shows task status.
- `.tag` with `.tag-ultra`, `.tag-overdue`, `.tag-high`, `.tag-wait` or `.tag-lead` adds small 5px-radius flags.
- `.state-dot.dot-{status}` is a 10px status dot. `.beh-dot` is an 8px semantic dot.
- `.avatar` with `-sm` (20px), `-md` (30px) or `-lg` (40px) shows initials on a light gray circle.

**Lists and tables**

- `.registry-table` › `.registry-row`, with `.is-head` for the header row. It's a dense 58px-row table: a selected row gets `--accent-pale` plus a 3px inset accent bar on the left, and on narrow containers it collapses to a stacked layout.
- `.rows` › `.task-row`: the classic task list (dot · title + tags · "Next: …" · meta · status pill + small latch).
- `.queue` › `.queue-row`: a numbered priority queue, where the first row gets the accent bar.
- `.mini-list` and `.exec-list`: light lists of links.

**Numbers and decisions**

- `.answers` › `.answer`: three big-number tiles. `.is-hot` adds a 3px accent top bar and turns the number accent-ink.
- `.home-stats` › `.home-stat`, and `.measure-grid` › `.measure`: smaller metric tiles.
- `.decisions` › `.decision`: decision cards with a 3px left severity bar (`.sev-critical` red, `.sev-high` orange), a definition list of facts, and option buttons.
- `.insight`: the "what · why it matters · what to do · who acts next" card.

**Feedback and overlays**

- `.callout`, `.callout-warn`, `.callout-go`: inline notes. `.boundary` is a small ⓘ caveat line.
- `.toast`: an ink bar at the bottom center, with an optional Undo.
- `.modal` with `.modal-head` and `.form` › `.form-grid` › `.field` (label `span` + input) and a sticky `.form-actions` footer. `.drawer` is the right-side sheet.

**Icons** are inline SVG on a 24×24 viewBox, `class="icon"` (18px), stroke-only at width 1.8 with round caps. `shell.html` has examples.

---

## 7. Voice and content

- Operational and plain, in sentence case. Say what's happening and who moves next: "Waiting on Marco", "Unlocks 2", "Handoff to Dana", "You act next", "No next action yet".
- Cards answer **What · Why it matters · What to do · Who acts next**.
- Use people's first names. Dates are short ("Due Oct 21"). Counts are exact.
- Use realistic roofing work: inspections, estimates, tear-offs, permits, insurance supplements, crew scheduling, first response to new leads. Data is synthetic, and the top bar shows the `Demo · synthetic` flag.

---

## 8. What to deliver

1. One HTML file built from `shell.html` that links `task-hq-studio.css`, with the new page in the content slot.
2. Any new CSS goes in a single `<style>` block that uses tokens only, with each new class commented. Keep it small; existing classes come first.
3. A short list of new classes and new components, so they can be added to `src/ui/nexus.css` and ported to React.
4. Show the page at **1440px** with the sidebar open, and at **390px** mobile. Include the empty state and a "needs attention" state.
5. Check accessibility: real buttons and links, visible focus rings (already in the CSS), color never the only signal, and AA contrast.
