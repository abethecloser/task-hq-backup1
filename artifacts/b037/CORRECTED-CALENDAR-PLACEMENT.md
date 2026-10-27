# Corrected Calendar quick-access placement

Supersedes the earlier Calendar placement addendum. The former standalone Calendar row below the main header was incorrect and is removed.

Application files changed in this correction: src/app/App.tsx, src/app/Sidebar.tsx, src/app/TopBar.tsx, src/ui/nexus.css. Regression updated: scripts/verify-b03-calendar-browser.js. Screenshots and this report added under artifacts/b037; earlier evidence preserved.

One shared Calendar navigation pair now renders in the left rail directly below Home on desktop, and in the existing top header beside the navigation-menu button on mobile. Calendar icon opens the full Calendar page. Its adjacent chevron toggles quick view, with an explicit accessible name and aria-controls/aria-expanded. No extra content row or header row. Desktop controls are24x44px in the existing56px rail; mobile controls44x44px. Focus outline is inset so the rail scroll container does not clip it.

Rendered inspection at1440,1024,375: exactly one launcher, located in rail/header; no standalone Calendar row in main content. Desktop pair x4..52,y114 (icon x4..28,tab x28..52); mobile pair x64..152,y112. Calendar desktop panel remains x56..344,288px; main reflows to1081px at1440 and665px at1024. Mobile Calendar375px full width. No horizontal document overflow observed. Screenshots: corrected-calendar-1440.png, corrected-calendar-1024.png (open), corrected-calendar-375.png; additional open views calendar-placement-open-*.png.

Updated rendered regression passed at all3 widths: navigation placement, unique control, adjacency to shortcut, correct panel targeting, viewport fit, Calendar restoration and initially-closed exception. Native Tab traversal showed a2px focus outline; Enter opened Calendar; Escape closed and restored launcher focus at all3 widths. Existing shared widths, permissions and handlers retained. Local demo uses App shared with LiveRoot; no live-account or physical-device verification claimed.

Checks:63/63 focused tests PASS; B03 verification script PASS; TypeScript PASS; isolated application build PASS (existing >500kB chunk warning); git diff --check PASS. All work local and uncommitted, no staging/push/deployment or production-data writes.
