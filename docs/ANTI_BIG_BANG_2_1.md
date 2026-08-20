# ANTI BIG BANG 2.1

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
5. **Real browser gate** — test the exact interaction that failed, including holding/opening the control across a background polling interval.
6. **Regression gate** — confirm cross-device sync still works after the UI interaction finishes.
7. **Release gate** — only after all gates pass may the draft PR be merged and production deployment considered.

## 2.1 interaction-preservation rule

The sync manager tracks active pointer/keyboard interaction with native controls (`input`, `select`, `textarea`, and `button`). During that protected window:

- `GVData.sync()` continues normally.
- The user's selected values and control are not replaced by `renderAll()`.
- A render requested by background sync is marked deferred.
- After the interaction ends, the deferred render is performed once.

This prevents a 5-second background poll from rebuilding the Order Log while a select box is open, without disabling live synchronization.

## Required browser test

- Open Order Log.
- Open/hold the real select/filter control.
- Allow at least one background polling interval to occur.
- Confirm the control remains open/usable and the selected orders remain selected.
- Change the selection normally.
- Confirm no new order is created and no existing order is modified merely by the interaction.
- After releasing the control, confirm remote changes still synchronize normally.
