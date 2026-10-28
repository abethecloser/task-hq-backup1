# Recovery of the reconciled Task HQ UI

Production deployment `dpl_Ds9aouACU1CgHHFWZxoavSMxDxPW` served commit `0abb0de` correctly. The regression was in source, not a stale deployment: merge `481a3ad` retained older versions of files from its first parent over the reconciled implementation already in `f2aa588` (PR #18).

Recovered the affected shell, navigation, Home styles, task creation/detail, entry/auth mode, workday, and live-adapter files from `f2aa588`. This restores the top section navigation, left calendar panel, right notifications/Ask panel, banner styling, compact metric styles, archive capability checks, HTTP status checks, and local-session sign-out behavior. Existing commits remain in history. No database or Edge Function deployment is part of this recovery.

Kept the newer typecheck command and current-dispatch parity check. Restored workday coverage in the test command. Frozen v5 engine files remain unchanged.

Validation before release:
- Full web/extension production build passed.
- 325 automated tests passed, zero failures.
- Server typecheck passed.
- Local built demo in Chrome: top sections render; Calendar opens left; notifications open right while Calendar remains open. Screenshot inspection confirms the recovered panel placement and styled banner control.
- Mobile/intermediate viewport and live-account mutation checks were not exercised in this recovery session.

Previous production URL for rollback: `task-baa1dcdif-novum-systems.vercel.app`.
