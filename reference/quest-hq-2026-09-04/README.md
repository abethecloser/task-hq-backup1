# Quest HQ: reference copy of the older build (2026-09-04)

A standalone, offline copy of the earlier "Quest HQ — Task Manager", kept as a point of comparison for Task-HQ.

## Source

- **Deployment:** `dpl_GbGAccmoJK7svfoE3hqXCb457Hku`
- **Project:** `task-management-quest`
- **Vercel team:** abetheclosers-projects
- **Created:** Fri Sep 04 2026 (production target)
- **URL:** https://task-management-quest-99axglm7z-abetheclosers-projects.vercel.app (behind Vercel login)
- **Fetched:** 2026-10-19 through an authorized Vercel CLI session.
- **Files:** 104, listed with their checksums in `SHA256SUMS.txt`.

## What's original, what's added

- `site/` holds the deployed files **byte for byte**. Nothing inside `site/` was edited.
- These were deliberately not copied:
  - **`env.json`:** the old build's Supabase connection.
  - **`sw.js`:** its offline service worker.
- With those two missing:
  - no Supabase client is ever created, so the copy cannot reach the old backend;
  - the service-worker registration fails harmlessly, so nothing is cached between runs.
- Added outside `site/`: this README, `SHA256SUMS.txt` and `serve.sh`.

## Running it

```sh
./reference/quest-hq-2026-09-04/serve.sh
```

Then open:

- **New task page:** http://127.0.0.1:4320/app.html?preview=1#/new
- **Home:** http://127.0.0.1:4320/app.html?preview=1
- **Another role or person:** add `&role=worker&member=kristine`, for example.

The old build has its own **preview mode** (`?preview=1`, honoured only on localhost). It skips sign-in and Supabase entirely and boots with the build's own sample data and an in-memory data store. Everything you see in preview is that sample data, and nothing is saved anywhere.

Server-only features answer that they're not available in preview: the AI assistant, email, and adding people.

The sign-in page (`index.html`) is included for completeness. It can't sign in, because there's no backend.

## Notes

- **Port 4320** keeps its browser storage separate from Task-HQ's local previews (4317, 4318) and from the dev server (5173).
- **Outbound requests:** Google Fonts, and the supabase-js library file from jsdelivr. That's only the library code; the copy never connects to a Supabase project.
- **Not committed to GitHub and not deployed.** It's a snapshot of another Vercel team's deployment; decide before publishing it anywhere.
