/* GotaVita Manager — Canonical Sync v2 runtime alias finalizer.
 *
 * script.js still contains historical synchronization functions for source-level
 * compatibility. Because those functions are global declarations, they can
 * overwrite aliases installed by sync-manager.js when script.js is evaluated
 * afterward. This finalizer runs last and restores the canonical public
 * synchronization boundaries without creating a second coordinator.
 */
(function () {
  "use strict";

  if (!window.GVSync?.flush) return;

  window.syncChangedResources = (reason) =>
    window.GVSync.flush(reason || "legacy-entry");

  window.syncNow = () =>
    window.GVSync.flush("manual");

  window.startSyncReliability = () => {};
  window.initSyncReliability = () => {};

  try {
    if (typeof window.stopSyncReliability === "function") {
      window.stopSyncReliability();
    }
  } catch (_) {}
})();
