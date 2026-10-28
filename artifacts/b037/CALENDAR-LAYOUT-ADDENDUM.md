# 3B Calendar sidebar and adjacent tab

Verified in the actual local demo at 375, 1024 and 1440 CSS pixels. No application layout changes were needed; approved left/right panel positions are preserved.

| Viewport | Calendar | Calendar tab, closed -> open | Notifications |
| --- | --- | --- | --- |
| 375 | x=0, width=375 | x=0; covered intentionally by the full-width open panel | x=0, width=375 |
| 1024 | x=56..344, width=288 | x=56 -> 344; width=139.23, height=44 | x=721..1009, width=288 |
| 1440 | x=56..344, width=288 | x=56 -> 344; width=139.23, height=44 | x=1137..1425, width=288 |

The desktop tab is flush with Calendar's right edge, beside the workspace. The 15px gap at the viewport's right is the existing vertical scrollbar. Calendar and Notifications have not been swapped. At mobile width, a close button inside the full-width panel replaces access to the covered underlying tab; Escape returns focus to that tab. This is the approved adaptive behavior, not a simultaneous mobile split pane.

Native Shift+Tab/Tab reached the tab with a visible 2px outline at every width. Enter opened Calendar; Escape closed it and restored tab focus. Its accessible name contains Calendar and aria-controls targets quest-sidebar on desktop or calendar-quick-drawer on mobile.

Rendered regression assertions verify visible 44px tab, correct target, actual Calendar content, viewport containment, desktop adjacency, opposite-side Notifications, restoration, initially-closed behavior, unchanged route and absence of horizontal overflow. Calendar temporarily suspends at 1024 and restores; wider desktop retains it alongside Notifications. Mobile uses one panel at a time.

Regression source: scripts/verify-b03-calendar-browser.js. Run through DevTools evaluate_script as an inline function on the local demo, once at each viewport after setting reduced motion. sourcePath loading was rejected by the browser tool's configured filesystem roots; inline execution of the identical source succeeded. Native keyboard checks were separately exercised through DevTools press_key. Raw results: calendar-layout-results.json.

Shared implementation verified from both entry points: src/main.tsx demo renders App; src/live/LiveRoot.tsx renders that same App with backend props. App supplies Sidebar/CalendarPullout, adjacent tab, and the mobile EdgeDrawer; there is no separate hardcoded demo layout. Live-account rendering remains untested.

No discrepancy found with the requested positions. Desktop/mobile screenshots in this directory remain applicable. All prior work and artifacts remain intact. Only this regression script and evidence were added for the addendum; no commit or push performed.

Checks rerun for this addendum: rendered layout 3/3 viewports PASS; native Calendar tab keyboard sequence 3/3 PASS; layout/focus unit tests 17/17 PASS; existing B03 verification script PASS; new script syntax and git diff --check PASS. An initial immediate post-resize run encountered an unsettled responsive render; the regression now waits for the shell to settle and all three final runs passed. Application source was unchanged, so previously passed TypeScript/build results were not unnecessarily repeated.
