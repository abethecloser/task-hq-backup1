# B03.5.2 local browser evidence

Actual interactions against the running worktree demo at localhost:5173; synthetic data only.

- Desktop viewport: 1440 x 1000. Workspace measured 1369px closed and 949px open for both Notifications and Ask. The in-flow right grid column measured 420px; workspace right and panel left both measured x=1005px.
- All five task table columns (Task, Assigned, Status, Priority, Due) remained left of the pane with either panel open. Task detail fields also remained entirely left of it.
- Closing Ask restored task-table width 1369px, route #/all-tasks/all, and scrollY=100. Task-detail checks restored width 1369px, route #/task/maple-tarp, and scrollY=150.
- With desktop Calendar open, workspace width changed from 1081px to 661px with the right panel, then returned to 1081px. Calendar remained open.
- At 375 x 812, both panels filled 375 x 812, with the workspace remaining 375px wide and no horizontal overflow. No desktop split is forced on mobile.
- A mobile scroll shift during a timed demo notice led to an explicit route-aware scroll-restoration correction. Final mobile checks restored scrollY=90 and route #/calendar after both panel closes. Ask retained two messages across close/reopen; switching to Notifications closed Ask.
- Inbox, Attention and Activity tabs rendered. Ask produced an existing read-only answer. Mobile Calendar retained its existing full-page navigation.
- No live authorization or production writes were tested.

Screenshots: desktop-notifications-table.png, desktop-ask-task.png, mobile-notifications.png, mobile-ask.png.

Checks passed: B03/B03.3/B03.4 verification script, 22 focused tests, TypeScript, isolated Vite app build, git diff --check.
