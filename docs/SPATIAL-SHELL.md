# Spatial shell — interaction contract

Behavioral reference: the archived Novum Hub / Workflow Grid Nexus project view
(`alexia-builds/novum-hub` @ `9b7ab01`, `app/(dashboard)/project/[id]/page.tsx`). Patterns reused,
no code copied:

- **Columns, not overlays.** Left | center | right are grid columns; opening a side panel resizes the
  center (`grid-template-columns` eases), it never covers it.
- **Edge toggles on the panel's inner border**, visible even when the panel is collapsed.
- **The rail never disappears.** The left side collapses to a 56px icon rail.
- **Content swaps in place.** Changing what a panel shows crossfades its content; only closing slides
  the panel away.

## Edges

| Edge | Holds | Opened by | Shown as |
| --- | --- | --- | --- |
| Top bar | Sections, centered when the bar has room (Home · Tasks · Projects · Calendar · Inbox), search, **New task**, Ask, bell, account | — | Fixed. It never moves when a panel opens. |
| Left | *Calendar quick view* on top, *Your work* (views with counts, projects) below | Menu button · rail Calendar icon · left edge toggle | Column beside the page, below the top bar (320px default) |
| Center | The page | Top bar sections | The largest region; keeps its scroll position while panels open |
| Right | *Notifications* (Inbox · Attention · Activity, threads) **or** *Ask* | Bell (Notifications) · ✦ (Ask) · right edge toggle | Column beside the page, directly under the bell and ✦ |
| Bottom | — (deferred; see Open) | | |

Calendar has two deliberate forms: the **rail icon** opens the quick view beside the page; the top
bar's **Calendar** opens the full page.

## State ownership

- Right panel: `notifOpen` / `askOpen` (at most one true) in `App.tsx`, rendered by **one**
  `EdgeDrawer` (`#right-edge-drawer`). Both modes stay mounted; the inactive one is `hidden`, so an open
  thread or an Ask conversation survives a switch. `askOpenLast` lets the edge toggle reopen the last mode.
- Left panel: `pullouts.calendar` (open), rendered by the existing workspace panel in `Sidebar.tsx`.
  One content: the calendar quick view, then the work views.
- Phones: one full-width panel at a time (`mobileCalendarOpen`, the right panel, or the menu).

## Transitions

| # | Case | Behavior |
| --- | --- | --- |
| 1 | Collapsed → open | The trigger opens its panel beside the page; the top bar stays put. |
| 2 | Open → switch content | Right: the other trigger (bell / ✦) swaps content in place; the panel never closes in between. Left has one content. |
| 3 | Open → close | The active trigger, the edge toggle, the panel's × or Escape. |
| 4 | Change page while open | Panels stay open. |
| 5 | Notification → task | The task opens in the center; on wide screens the panel stays open. On phones the panel closes. |
| 6 | Calendar quick view ↔ full page | The rail icon toggles the quick view; *Open full calendar* or the top bar's Calendar goes to the page. |
| 7 | Both edges open | Both stay docked while the center keeps a usable width (`core/layout.ts`); if not, the left one gives way temporarily and returns when the right one closes. |
| 8 | Desktop → tablet → phone | Below 761px each panel becomes a full-width panel and only one shows at a time. Calendar moves to the tab bar. |
| 9 | Keyboard | Escape closes the open panel; focus returns to the trigger that opened it. Tab stays inside an open phone panel. |
| 10 | Return | Closing restores the page as it was (scroll is preserved). |

## Root causes fixed (2026-10-27)

- **"It moves and goes back in"** when switching between notifications and Ask: they were two
  separate drawers, so a switch slid one out and the other in. Now one drawer swaps its content.
- **Top-right icons shifted left** when the right panel opened: the top bar lived inside the
  shrinking center column. It now spans the panels, which open below it.
- **Calendar kept getting harder to find**: it went from a left pull-out tab to a bottom sheet to a
  nested toggle. It now has one fixed spot: the rail's Calendar icon, which opens the quick view
  beside the page.

## Open

- Top quick-action strip and bottom contextual deck: not built yet. They should be added only if
  a real task journey needs them.
- Verified in the local demo (Chromium at 1440 and 375px). Not yet checked on a physical phone,
  with a screen reader, or with live accounts.
