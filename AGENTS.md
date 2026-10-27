# Task HQ — Novum Agent Flow project extension

This project extends the supplied Novum Agent Flow Shared Operating Standard v1.0. Preserve that standard's human authority, existing work, permissions, and evidence boundaries. This file adds project guidance only; it does not replace global agent settings.

## UX-first implementation and loop prevention

1. Before a UI change, identify the user's intended outcome, interaction sequence, component hierarchy, layout behavior, and responsive states.
2. Inspect existing components, design tokens, implementation patterns, and relevant project resources before building or repositioning controls.
3. Establish explicit acceptance criteria and compare the rendered experience at desktop, intermediate, and mobile widths against them.
4. Small UI fixes have at most three implementation attempts. If the first two attempts fail, stop before a third: identify the root cause and recommend the highest-leverage next action or alternatives. Do not start a third attempt without resolving that decision with the user.
5. Never repeat essentially the same failed adjustment without new evidence.
6. If the rendered implementation contradicts the intended design, report the mismatch; do not call the task complete.
7. Distinguish automated tests from actual visual, interaction, physical-device, live-account, and production verification. Claim only what was exercised.
