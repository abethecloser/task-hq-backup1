# Production white-screen incident — 2026-10-21

Production now renders the sign-in form in real Chrome with zero uncaught runtime errors.

## Exact failure

Deployment `dpl_5qYmYxR7nefSNit9cguGnzaV37sb` (`task-n2f0292mm`, commit metadata `6fc94d7a`, gitDirty=1) embedded literal `[SENSITIVE]` for both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. HTML and both JS chunks returned HTTP 200 with correct MIME types. Fresh, isolated Chrome reproduced `Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.` during Supabase client creation, leaving an empty body. This was a build configuration failure, not a browser cache problem or a demonstrated navigation runtime defect.

Vercel metadata marks both browser-public variables sensitive; production `vercel env pull` reproducibly exports `[SENSITIVE]`. The observed failure is consistent with building a prebuilt release from these redacted exports. The precise original build command was not recovered. See https://vercel.com/docs/environment-variables/sensitive-environment-variables . Values were recovered from the prior working publicly served browser bundle, with the URL checked against the existing Quest backend documentation. No service-role credential was used.

## Recovery and correction

1. Restored previous Ready production deployment `dpl_3bqzr4G23RidAxtKB7eQW7X2ZBmB` (`task-btfin6f26`, `b9991ddf`) before preparing the correction. Verified its sign-in screen in fresh Chrome with no runtime errors.
2. Exported commit `6fc94d7a` to isolated `/private/tmp/quest-white-screen-fix`; retained its navigation changes. Added production build configuration validation and an HTTP(S) URL check before runtime client creation. `correction.patch` records these source changes against that exact commit.
3. Built using previously working public backend configuration, and updated the two existing Vercel production browser-build variables to those same values. Sensitive classification remains; pulled placeholder values must never be used as actual build inputs. Other variables, Supabase permissions, functions and records were not changed.
4. Ran full `npm run build` using Node 24: passed. Ran focused navigation and auth tests: 13 passed. Negative test confirms `[SENSITIVE]` URL is rejected before building. Initial local Node 23 test attempt could not load TypeScript; reran successfully with Node 24. Initial preview server attempt was sandbox-blocked; reran with approved permissions.
5. Real Chrome render smoke passed against the local production build. Packaged that exact dist as Vercel Build Output, retaining the existing production route/security configuration. Staged with `--prod --skip-domain`; downloaded candidate HTML and JS through authenticated `vercel curl` and confirmed both were byte-identical to tested local outputs.
6. Promoted Ready candidate `dpl_ExqepK2nCLrhPtyDTE8C4Vsxca3Q` (`task-o1mli6khw-novum-systems.vercel.app`). Verified `https://task.questroofing.com` serves the corrected bundle `index-DoxwrdpY.js`, all loaded assets return 200, and the sign-in form renders with zero uncaught errors in fresh Chrome. No authenticated production user journey was performed.

## Preservation and release handoff

Original development branch remains `dev/t1-t2-dispatch-parity` at `95043cb`; before/after porcelain status was byte-identical before adding this incident report. Existing `.worktrees/release` remains clean at `6fc94d7a`. No reset, clean, branch switch, database mutation or Supabase permission change was performed. This report and patch are new files only. No source commit was pushed or merged. Apply the patch to the matching release branch before its next source-based deployment; the main dirty development checkout was intentionally not patched.

Retained rollback deployment: `task-btfin6f26-novum-systems.vercel.app`.

Current correction: https://vercel.com/novum-systems/task-hq/ExqepK2nCLrhPtyDTE8C4Vsxca3Q .
