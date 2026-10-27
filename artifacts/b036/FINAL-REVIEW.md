# B03.6 final review — acceptance held

Reviewed the complete tracked diff and untracked implementation/review files against HEAD 2a3fd83, which matches origin/main and includes merged Batch 2 PRs #12–#14. No application source was changed during this review. This report is the only added file.

## Outstanding acceptance findings

### High — drawer keyboard focus

Actual browser keyboard input reproduced two related gaps in the shared EdgeDrawer behavior:

- At 375px, open Ask or Notifications, focus the first close control, then press Shift+Tab. Focus moves to the underlying Overview navigation button, which is covered by the full-width panel. The underlying main element is not inert and the panel does not constrain keyboard traversal.
- At desktop width, focus the Ask launcher and press Enter. The panel opens, but focus can remain on the launcher. Escape from there does not close Ask because its handler is scoped to the panel. The existing shell Escape handler can instead receive the event.

Relevant code: src/ui/EdgeDrawer.tsx (focus effect and scoped Escape handler), src/app/AskTasks.tsx (input focus effect), and src/app/App.tsx (global Escape handler). This review establishes symptoms, not a confirmed timing root cause. Keyboard acceptance is not complete.

### Medium — narrow-desktop restoration exception

At 1024px with Calendar already open:

| State | Calendar | Workspace x | Workspace width |
| --- | --- | ---: | ---: |
| Before Notifications | open | 344px | 665px |
| Notifications open | closed | 56px | 665px |
| Notifications closed | closed | 56px | 953px |

The route remains unchanged. This follows the existing openPullout/bothFit mutual-exclusion policy reused by Batch 3, but strict restoration of the preceding Calendar/workspace layout is not satisfied. Relevant code: src/app/App.tsx showPullouts/toggleNotifications/toggleAsk and src/core/layout.ts openPullout/bothFit.

## Verified current behavior

- Desktop viewport 1440x1000: Calendar, Notifications and Ask each measured 288px at the default persisted width. Workspace width changed from 1369px to 1081px and returned to 1369px on close; route and scrollY=100 were preserved in the ordinary single-panel case.
- Actual keyboard resizing of Calendar using ArrowRight changed all three measured widths to 304px. Enter reset Calendar and the open Ask pane to 288px. The persisted sidebar.width is the shared source; right shells fill their grid column.
- Notifications uses a genuine in-flow desktop grid column; all five task-table column headers remained outside it. Task name, Notes, Waiting on, comments, watcher selection and other visible task fields had 0px borders, transparent backgrounds, no background image and no shadow.
- Home At Risk expanded from 4 to 6 items and collapsed back to 4 after React updates settled. It uses the existing risk array, not the overdue registry filter.
- Earlier Home situation labels, creation visibility and project priority/status/blocked/completed cases remain in the diff and pass the B03 synthetic verification script. The role fixtures are presentation examples, not authenticated-role acceptance.
- At 375px, right panels fill the viewport. Their content and close controls remain reachable by pointer and there is no horizontal document overflow in the checked demo/sign-in screens. Keyboard focus has the exception above.
- Demo banner, header and search have no persistent bottom border, background-image underline or shadow.
- Regular signed-out sign-in page: email/password fields are transparent, borderless, gradient-free and shadow-free at desktop and 375px. Actual Tab navigation moved from email to password with a visible 2px solid focus outline.
- Intentional structure remains: table/task-facts separators, active-tab indicators, status-pill styling, action-button borders, drawer boundaries, brand accents, and the original outer sign-in card/artwork/shadow. These are not field decoration.
- Source inspection confirms notification thread/channel/lead flows reuse existing components and action handlers, retain Critical Focus checks and membership filtering, and do not alter core engine/backend permission code.

## Checks run for this review

- scripts/verify-b03-flow.mjs: PASS (B03, B03.3 and B03.4 assertions).
- 53 focused tests: PASS across dashboard, compose, registry, permissions, layout-pullouts, awareness, inbox, and dropdown-controller tests.
- npx tsc --noEmit: PASS.
- Browser backend configuration validation: PASS; no sign-in or production action was submitted.
- Isolated Vite application build: PASS, output /private/tmp/quest-b036-final-build; same app entry points and React plugin, configFile:false to avoid the shared node_modules config-temp write restriction.
- git diff --check: PASS.

Static/synthetic checks do not cover the two browser findings. No live-account, physical-device, screen-reader, operating-system keyboard/IME or production-write verification is claimed. Calendar's existing mobile behavior remains full-page calendar navigation rather than a desktop split pane. Earlier B03.5.2 screenshots/documentation describe the historical 420px stage; current measured desktop widths are 288px/304px as above.

## File inventory

Modified tracked files (16):

- src/app/App.tsx
- src/app/AskTasks.tsx
- src/app/Awareness.tsx
- src/app/CompanyWork.tsx
- src/app/Home.tsx
- src/app/Inbox.tsx
- src/app/NotificationDrawer.tsx
- src/app/Sidebar.tsx
- src/app/TopBar.tsx
- src/auth/auth.css
- src/ui/brutalist.css
- src/ui/components.tsx
- src/ui/home.css
- src/ui/nexus.css
- src/ui/quest.css
- src/ui/studio.css

Untracked implementation/review files:

- src/ui/EdgeDrawer.tsx
- scripts/b03-review.html
- scripts/b03-review.tsx
- scripts/verify-b03-flow.mjs
- artifacts/b0351/{task-desktop,task-mobile,signin-desktop,signin-mobile}.png
- artifacts/b0352/{desktop-notifications-table,desktop-ask-task,mobile-notifications,mobile-ask}.png
- artifacts/b0352/README.md
- artifacts/b036/FINAL-REVIEW.md

All work remains local and uncommitted. No commit, push, merge, deployment, production-data change, or QuestBase modification occurred. Recommendation: resolve or explicitly adjudicate the two acceptance findings before accepting Batch 3. Awaiting human review; no further implementation authorized by this review has been started.
