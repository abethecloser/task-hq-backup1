# Abraham's feedback: old Quest HQ build vs Task-HQ (2026-10-19)

**Source:** Abraham's screen recording, sent by WhatsApp ("WhatsApp Video 2026-10-19 at 7.55.48 PM.mp4", 6 min 40 s). It shows the old Quest HQ build on the left and Task-HQ on the right. Transcribed locally with whisper.cpp; frames reviewed.

**Summary:** keep Task-HQ's style and cohesiveness. Bring back the old build's speed: change things right in the list, open tasks full screen, and have handoffs that create the next task.

## Task list (All Tasks)
1. **Bigger text.** Rows read too small.
2. **Edit in the row without opening the task**, as in the old build:
   - **Status** as colored pills with a dropdown ("I can change the status without having to actually click on here").
   - **Priority** with a dropdown.
   - **Label** (for example "Lead"), customizable.
   - **Assignee**, changeable on the fly ("maybe on the fly we just need to change who's assigned to it").
   - **Due date.**
3. **A bigger, dedicated New task button.** Today it's "kind of hidden in between these searching things".

## Opening a task
4. **Full screen, not a side panel.** "Whenever I click on a task, I don't want it to be on the right side, I want a full screen like this. I don't like these sidebars for this kind of deal." The model is the old task page: title, status, people, brief, then Details, Comments / Activity / History, and Quick actions.
5. **Quick actions as in the old build:** Nudge, Request help, I'm stuck, Reassign, More.
6. **Watchers:** "let's say I assigned a task to Kristin, I want to be a watcher, so I can be aware of what's going on with any comments or notes."

## Creating a task
7. **Say "Assigned"** instead of "Owner". The Priority dropdown is fine.
8. **The next-step owner creates the follow-up task.**
   - **Example:** "Call Donohue: figure out the draw schedule and agreement". When done, it hands off to Kristin and automatically creates her next task, "Create contract".
   - He likes the next-step owner field. Presets for common follow-ups would help.
9. **Add a project on the spot** with a "+" button. Projects are named after the street address.
10. **Company switch:** Roofing, Construction or Drafting. "If it doesn't take too much time, do it now; if not, later on."
11. **Simpler create form.** "It looks a little bit more complicated."

## Not a priority now
- Dashboard widgets. Team workload and "active right now" are fine as they are.

## Seen in the recording
- **Creating a task hit "One of the chosen people is not in this workspace."** Most likely he picked Kristin before she joined.
- **Abraham is already using Task-HQ for real work:** "Call DOnohue", and "Emad's framing inspection" assigned to Alkeith.

## Delivery plan
- **Batch 1:**
  - full-screen task page;
  - edit status, priority, assignee and due date in the list row;
  - bigger list text;
  - prominent New task button;
  - "Assigned" wording;
  - adding watchers from the task page.
- **Batch 2:** next-step follow-up task creation, a simpler create form, quick-action parity.
- **Batch 3:** projects "+", labels, and the company switch. Blocked until the live server upgrade (`operational_attention` migration and the repository dispatch), because the patched live server can't create projects or save types or tags.
