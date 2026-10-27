# Notifications width and tab alignment

Localized change: src/ui/nexus.css only (plus this review evidence). Prior B03 changes and artifacts remain preserved.

Inspection found Notifications and Ask already use sidebar.width from Calendar's persisted actor preferences. Default remains 288px; keyboard ArrowRight produces 304px; no independent width was introduced. The reported screenshot was not attached in this turn, so its exact runtime state could not be compared. Current shared widths did not reproduce a mismatch. A previously persisted smaller value (minimum 232px) remains legitimate and is not silently overwritten.

The tab strip used content-sized auto columns, 1px button padding, and inherited overflow-wrap:anywhere. Those columns produced uneven spacing and allowed tiny intrinsic widths even though existing nowrap prevented wrapping in tested cases. Changed to repeat(3,minmax(max-content,1fr)), explicitly normal overflow-wrap/word-break, and 2px inline padding. This balances available space while preserving each label/badge pair's minimum width. Existing active styling, keyboard handlers, 44px targets, no-wrap badges, and existing 99+ cap remain intact. No claim is made that the missing screenshot's exact cause was reproduced.

## Verified after change

- Local browser synthetic count fixture: 21 cases, all passed. Viewports 1440/1024 with panel widths 288/304/232, and viewport 375 with full-width panel; each tested counts 4, 11, 101 (display99+). Labels/badges single-line; no clipped controls or page overflow; all targets44px high. Activity retains its existing no-badge semantics.
- Actual shared demo: Calendar/Notifications/Ask all measured288px, then304px using native keyboard resize, at1440 and1024. All measured375px on mobile. Open/close sequence preserved current route and scroll80. Test resize reset to288 afterward. Desktop workspace still reflows.
- Existing B03 verification script PASS; focused suite63/63 PASS; TypeScript PASS; configuration validation PASS; isolated Vite application build PASS; git diff --check PASS. Build retained a bundle-size warning (chunks over500kB).
- Evidence: notification-sizing-results.json, desktop-notification-tabs-11.png, mobile-notification-tabs.png.

No live account, physical device, or screen-reader verification claimed. All changes local and uncommitted. No staging, push, deployment, QuestBase changes or production-data writes.
