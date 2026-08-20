# ANTI BIG BANG 2.2

## Purpose

Prevent background synchronization from destroying an active UI interaction while preserving live cross-device synchronization.

## Core rule

**Synchronize data independently from rendering UI.**

A background sync may continue while a user is interacting with a form control, but a full UI rebuild must be deferred until the interaction is safely finished.

## Release gates

1. **Isolation** — work starts from the known-good production/main SHA.
2. **Single-purpose patch** — change the smallest boundary that owns the failure.
3. **No business-logic rewrite** — do not modify order creation, order updates, sync transport, conflict resolution, or persistence for a UI-only defect.
4. **Automated verification** — CI must pass before browser verification.
5. **Real preview gate** — test the exact interaction on the candidate deployment, never on production before merge.
6. **Real browser gate** — hold/open the exact control across a background polling interval and verify the DOM and selected state remain intact.
7. **Regression gate** — confirm synchronization still works after the interaction finishes.
8. **Release gate** — only after all gates pass may the draft PR be merged and production deployment considered.
9. **Fresh production gate** — verify the merged change in a fresh browser session after deployment.

## 2.2 interaction-preservation rule

The sync manager uses the **focused control** as the authoritative interaction boundary for native `input`, `select`, `textarea`, and `button` controls. Pointer timing alone is insufficient because native select/checkbox popups may release pointer events while the control remains focused.

During that protected window:

- `GVData.sync()` continues normally.
- `renderAll()` is deferred while a relevant control remains focused.
- The Order Log list is not rebuilt underneath the active interaction.
- Selected controls are not replaced by fresh DOM nodes during the protected window.
- Once focus actually leaves the control, one deferred render may execute.
- Browser-only protection is capability-gated so Node/VM synchronization tests remain safe.

This preserves live synchronization without allowing background polling to destroy an active Order Log selection interaction.

## Required browser test

- Open Order Log in the isolated candidate preview.
- Select several orders using the real control.
- Hold/open the select/filter interaction across at least one 5-second polling interval.
- Confirm the list does not rebuild or disappear.
- Confirm selected orders remain selected.
- Change the selection normally.
- Confirm no new order is created and no existing order is modified merely by the interaction.
- Release the control and confirm normal synchronization resumes.
- After merge/deployment, repeat the critical check in a fresh Incognito session.
