# B04 — attached Calendar pull-out review

Completed the written interaction contract in one structural implementation attempt. All existing B03 work and review artifacts remain preserved. No commit, staging, push, deployment or production-data changes.

## Intended flow and acceptance

Calendar icon remains a full-page navigation link near Home below the Task HQ logo. A substantial orange outlined tab extends from that navigation row, with an obvious chevron and rounded outer edge. Tab toggles quick view beside the rail, follows the panel's outer edge when open, and returns when closed. Main content reflows; mobile uses the existing full-width Calendar drawer. No standalone Calendar row below the page header.

The navigation hierarchy is now explicit: Home/Calendar remain in the non-scrolling primary group, secondary navigation retains its own scroll area. This lets the attached tab extend outside the compact56px rail without being clipped by a navigation scroll container. This replaces the prior structural limitation rather than layering repeated position nudges on it. Tab uses existing accent tokens and Calendar's --panel-offset; no independent panel sizing state. Calendar heading and collapse control remain inside the existing quick-view panel.

## Files changed in B04

- src/app/Sidebar.tsx: primary/secondary navigation hierarchy; Calendar keyboard entry and close-control focus restoration; accurate full-Calendar navigation label.
- src/app/App.tsx: interaction comment and full-Calendar aria-current state.
- src/ui/nexus.css: attached tab geometry, outline/accent/chevron, secondary scroll region, mobile treatment, reduced-motion and resize behavior.
- scripts/verify-b03-calendar-browser.js: regression assertions for attached tab, outline, row alignment and movement with panel edge.
- AGENTS.md: repository-scoped Novum Agent Flow extension. No repository or ancestor AGENTS file existed. The user-supplied Novum standard remains authoritative; global instructions were not edited. Added the requested7 UX-first/loop-prevention rules, including stop-and-diagnose after two failed attempts before attempting a third.
- artifacts/b04/: this report, raw browser results, six closed/open review screenshots. Earlier B03 artifacts are untouched.

## Actual browser results

Local synthetic demo on127.0.0.1:5179. The prior browser tab/server were gone; sandbox loopback binding returned EPERM, and approved launch on5173 found an occupied port. Started this worktree on5179 without killing or changing the other process.

| Viewport | Closed tab | Open Calendar and tab | Main workspace |
| --- | --- | --- | --- |
| 1440 | x56..92,36x48 | Calendar x56..344,width288; tab x344..380 | reflows to1081px |
| 1024 | x56..92,36x48 | Calendar x56..344,width288; tab x344..380 | reflows to665px |
| 375 | header beside menu,44x44 | Calendar full375px width with heading and close | retains375px, no cramped split |

Inspected actual screenshots in both states at all three widths. Calendar icon centered in its row, logo above Home, attached tab visible, no document horizontal overflow, no duplicate Calendar content row. Mobile bottom navigation remains present when drawer is closed. The open mobile drawer intentionally occupies the viewport and has its own close control.

Native Shift+Tab/Tab reached the tab with visible focus at each width. Enter moved focus into Calendar; Escape closed it and restored focus. Full Calendar icon navigated to#/calendar. At1024, keyboard resize produced304px for Calendar, Notifications and Ask, with tab x360 following Calendar's edge. Closing either temporary right panel restored Calendar, route and scroll80; resize reset to288 afterward. Existing rendered regression also passed initially-closed and temporary restoration cases at all three widths. Notifications/Ask retain existing focus controller and permissions/data handlers.

## Checks and limits

- Focused tests63/63 PASS.
- Existing B03 verification script PASS.
- TypeScript PASS; browser configuration validation PASS.
- Isolated application Vite build PASS at/private/tmp/quest-b04-local-build. Existing chunk-size warning remains; extension build was not repeated.
- git diff --check PASS.

No physical-device, screen-reader, live-account or production verification claimed. No visual reference image was attached to this B04 request; visual assessment used its explicit written geometry/color/flow criteria. User visual acceptance remains pending.

Screenshots: calendar-1440-closed.png, calendar-1440-open.png, calendar-1024-closed.png, calendar-1024-open.png, calendar-375-closed.png, calendar-375-open.png. Raw automated rendered/keyboard results: browser-results.json. Repository remains on ux/b03-adaptive-flow with the original18 tracked modifications plus untracked instructions, implementation, scripts and evidence; nothing staged.
