# Task Management x QuestBase visual comparison

Prompt: TASK-20261108-001  
Status: implementation baseline, before the My Work landing change

## Side-by-side layout

| Spatial layer | Cloudflare reference | QuestBase shell | Task Management before | Task Management target |
|---|---|---|---|---|
| Identity and scope | Persistent account context and product navigation | Organization and workspace context in the top bar | Live workspace identity in Task's own session; demo is explicitly marked | Keep Task-owned identity and scope; no fabricated SSO |
| Left region | Persistent, collapsible product/account navigation | Rail with expandable Base/HQ navigation | Persistent instrument rail; expandable work navigator | Preserve rail and tree; label the landing destination My Work |
| Center | Broad primary working surface | Authorized workspace canvas | Dashboard-led Home with metrics and secondary work panels | Existing situation-first actionable Task surface by default |
| Right region | Contextual actions alongside the current account/work | Context lens and contextual tools | Calendar, Ask and Notifications share a right-side panel | Keep the existing Task context panel and its independent behavior |
| Narrow screens | Navigation and contextual panels remain reachable | Rail/menu and context sheet adapt | Existing phone menu, bottom dock and drawer behavior | Keep those responsive transitions and the same task routes |

## Concrete comparison

<pre>
Cloudflare          QuestBase             Task Management (before)   Task Management (target)
account/product     org/workspace         task rail                  task rail
left navigation     left navigation       collapsed work nav         work views
wide center         authorized canvas     KPI/report dashboard        My Work situation
quick actions       context lens          contextual drawer           contextual drawer
</pre>

The current Task render was opened at http://127.0.0.1:5173/?demo, then the explicitly labeled synthetic demo was entered. It showed a broad, KPI-first Home. The work engine already contains WorkSurface, which composes a prioritized situation and authorized next actions. This increment promotes that existing surface and retains the dashboard behind an Overview switch.

QuestBase's local shell source establishes top-bar organization/workspace context, a left rail and expandable navigation, a central authorized canvas, and a contextual lens (src/ui/AppShell.tsx, src/ui/frame.ts, src/ui/nav.ts). The /hq route in the local checkout presents its access gate because local Base credentials are not configured. Task remains separately authenticated and retains its own task dispatch and permission authority.

Cloudflare reference behavior comes from published dashboard materials: persistent account/product navigation, context switching and contextual actions. See [Cloudflare dashboard navigation shortcuts](https://developers.cloudflare.com/changelog/post/2026-05-04-keyboard-shortcuts/) and [Cloudflare's unified application security dashboard](https://blog.cloudflare.com/new-application-security-experience/). Cloudflare's authenticated account UI was not available in this session, so no live Cloudflare account inspection is claimed.

## Design decisions

- Preserve the existing Task shell, routes, task engine, dispatch path, records, and permissions.
- Change the semantic landing label from Home to My Work.
- Render Task's existing WorkSurface first; keep the current configurable dashboard reachable as Overview.
- Remember only this view preference in browser storage, scoped to the current Task workspace and person. It does not create or change operational records.
- Keep Task identity independent. No QuestBase session handoff, shared identity, or cross-product data synchronization is implied.
