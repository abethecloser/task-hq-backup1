# Quest Task-HQ — Access Guide

_Prepared 2026-10-19. No passwords, keys or setup codes in this document. Never put them in email or chat._

## The app

| What | Link |
|---|---|
| **Task-HQ (production)** | https://task-hq-three.vercel.app |
| Sign in | https://task-hq-three.vercel.app/#/auth/sign-in |
| Forgot password | https://task-hq-three.vercel.app/#/auth/forgot |
| Employee setup page (for setup links / codes) | https://task-hq-three.vercel.app/activate/index.html |
| Demo (synthetic data, safe to explore) | "Explore the Task-HQ Demo" on the sign-in page |

**Your account:** team@enternovum.com, **Admin** in Quest Roofing.
**Owner:** Abraham (admin@questroofing.com). He alone grants Admin or Owner.

## Finding your way around

- **Work / Manage switch** (top bar). **Work** is daily tasks. **Manage** holds Projects, Team, Reports, Executive Desk, Activity, Feedback and Policy & data. Only Owner, Admin, Supervisor and Developer / Observer see Manage.
- **People & Access:** Manage → **Team**. Add people, send setup links, link existing accounts, change roles, revoke links and invitations.
- **Change password:** account menu (top right) → **Change password**.
- **Left panel:** Inbox, Attention and Activity. Toggle it with the arrow on its edge.
- **Right panel:** the Instrument Deck (Signals / Calendar / Insights), or the task you have open. Both panels can stay open together.
- **Tasks:** open a task to comment (use **@Name** to mention someone), ask for help, report a blocker, hand it off or move it forward. History is kept on every task.
- Some sections show **"Under construction :)"**. That's a temporary restriction, not a permission problem.

## Who can do what

| Role | Can |
|---|---|
| **Owner** (Abraham) | Everything, including granting Admin or Owner, Ultra Priority authority and the workspace name. |
| **Admin** | Routine operations, people (Members and Supervisors), assigning and reassigning work, response and stalled-work settings. |
| **Supervisor** | Coordinating the team: assigning and reassigning work, clearing blockers, triaging feedback. No settings. |
| **Member** | Their own tasks: create, update, complete, comment and @mention, ask for help, watch tasks. Can't assign others' work. |
| **Developer / Observer** | Sees everything read-only and leaves feedback. |

Job titles (Manager, Coordinator, Field…) only route work. They never grant permissions.

## Team status

| Person | Status | Next step |
|---|---|---|
| Abraham | Active Owner | Make the first real assignments. Optionally complete the two old test tasks named "s". |
| Alexia (team@enternovum.com) | Active Admin | — |
| **Kristin Montes** (monteskristint@gmail.com) | Invitation open as **Admin / Coordinator** until Nov 2 | She signs in with her own password, then clicks **Join Quest Roofing**. If she's forgotten the password, she uses Forgot password. |
| **Alkeith Cabezzas** (alk.constructionsolutions@gmail.com) | Open **Admin** invitation, no account | **Abraham decides Supervisor or Admin.** If Supervisor: change his planned role in People & Access, revoke the Admin invitation, then send a setup link. |
| **Ralph Palad** (ralphalexispalad@gmail.com) | Approved Member / Field, not set up yet | In People & Access, **Send setup link**, copy his personal message and email it to him. The link works once and expires in 24 h, and he chooses his own password. |
| QA (qa.prototype.33@gmail.com) | Active Member / Field (testing) | Keep as is. |
| Shan, Rom | Not set up | Need verified emails and intended roles first. |

## Quick first-day check
1. Abraham assigns a real task to Ralph (or the QA account).
2. That person opens it and comments "@Abraham …".
3. Abraham sees the mention. Comments and mentions are working.

## Known limits (not blocking)
- Tasks use the single **General** project for now. You can't create projects or job sites yet.
- Reopen, task types, tags and due times aren't on the live server yet. They show a clear "not available" message.

## Admin consoles (for Alexia)

| What | Link |
|---|---|
| Supabase project | https://supabase.com/dashboard/project/xthyyxnfjaxmtrqrhyxc |
| Auth → URL Configuration (Site URL = production) | https://supabase.com/dashboard/project/xthyyxnfjaxmtrqrhyxc/auth/url-configuration |
| Auth → Users | https://supabase.com/dashboard/project/xthyyxnfjaxmtrqrhyxc/auth/users |
| Auth → Email Templates | https://supabase.com/dashboard/project/xthyyxnfjaxmtrqrhyxc/auth/templates |
| Vercel project | https://vercel.com/novum-systems/task-hq |
| GitHub repository | https://github.com/Lumen-Marketing/task-management-platform |

**Current release:** commit `1cff498` on `main`, deployment `dpl_FUdjuboqvfPoaFouAgYcyiUC2A3X`.

**Optional:** in Email Templates → Reset Password, point the link at
`{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery#/auth/reset`
so reset links work on any device, not only the browser that requested them.

## Security reminders
- Everyone chooses their own password. Nobody shares passwords.
- Setup links work once and expire after 24 hours. Send them only to the person's verified email.
- The Supabase secret (service-role) key never goes into email, chat, the app or source files.
- Owner and Admin access changes need Abraham's approval.
