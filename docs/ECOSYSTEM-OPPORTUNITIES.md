# Task HQ refinement and ecosystem opportunities — 2026-11-01

Task HQ remains independent. All Things Quest is shared ecosystem context, not a platform, database, hierarchy, or mandatory integration. Quest Base and Lumen Marketing are distinct products. This increment changes only navigation presentation and keyboard behavior; it adds no ecosystem services.

## Delivered locally

Preserved baseline `f10f285` (PR #43) and all pre-existing local dashboard/Living edits on `feature/living-graph-restoration`. Collapsed navigation has centered 44px controls, one borderless header toggle, anchored account/settings, and Escape-to-collapse with focus retained. Expanded navigation keeps its width preference and labeled tree. Inspector and collaboration dock retain their existing state and layout ownership.

## Existing implementation versus opportunities

| Area | Existing code evidence | Proposed smallest useful next step |
| --- | --- | --- |
| Identity and permissions | `src/live/LiveRoot.tsx` resolves memberships; server authority is distinct from work roles | For one approved integration, explicitly map issuer, subject and organization. Do not reuse another product's roles or assume common login. |
| Independent capabilities | `src/core/navigation.ts` registers destinations; Home registers dashboard modules; neither is a cross-product capability registry | Define a small versioned descriptor only when a second product needs to discover an actual capability: product ID, supported action, entry URL, required scope and availability. |
| Canonical records | `Task.id`, `projectId`, `dependsOn`, owner and approval relationships; scoped references in `src/core/references.ts` | Use a namespaced reference `(product, organization, record type, immutable ID)` and an authorized deep link. Keep the originating product authoritative. Task HQ currently has one project ID per task; multi-homing would require an explicit contract change. |
| Events and integrations | Org-filtered realtime in `src/adapter/live.ts`; approved source IDs and stable external IDs in `src/integrations/communications.ts`; engine-mediated `runTaskHooks` | Trial one consumer of a committed event with event ID, source, organization, record reference, version and timestamp. Require deduplication and retry evidence before writes. Realtime database updates are not a cross-product event bus. |
| Context and intelligence | Responsibility, dependency checks, notifications and dock task context reuse Task HQ records | First show an authorized linked record's context and one useful next action. Do not copy entire records or introduce inferred ownership. Shared notifications require recipient mapping and permission checks before exposing titles. |

Highest-leverage candidate: one read-only record reference and deep-link journey between Task HQ and a product with a confirmed business requirement. Validate identity, permission denial, unavailable source, and independent operation before considering shared services. This is proposed, not implemented or connected.

## Behavioral references reviewed

- [Monday webhooks](https://developer.monday.com/api-reference/reference/webhooks) and [OAuth scopes](https://developer.monday.com/apps/docs/oauth): explicit subscriptions and scoped authorization, not a shared database assumption.
- [Asana object hierarchy](https://developers.asana.com/docs/object-hierarchy): one canonical task can have multiple memberships; borrow the identity principle without silently changing Task HQ's single-project contract.
- [Refero](https://refero.design/): research complete interaction flows; no particular gated flow was inspected or copied.
- [Framer accessibility](https://www.framer.com/help/accessibility/): preserve semantic controls and reduced-motion behavior.
- [21st sidebar](https://docs.21st.dev/%40wensity/components/sidebar): header/navigation/footer separation. Reused Task HQ components; no dependency or external component added.

## Verification limits

Local synthetic demo only. Typecheck, 396 tests, production build and diff checks passed. Browser measurements at 1440, 1024, 375 and 430px found no document overflow; the mobile rail and desktop dock yield to existing mobile navigation. Expanded/collapsed and keyboard paths checked in the browser. No real-account, physical-device, cross-product, or production acceptance claimed. No deployment performed; production review and authorization remain separate from local build verification.
