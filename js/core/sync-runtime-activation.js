/* GotaVita Manager — Canonical Sync v2 runtime activation.
 *
 * Compatibility hook retained because state.js still references this path.
 * It must never create a second synchronization coordinator.
 * GVSync remains the sole owner of synchronization and state replacement.
 */
(function () {
  "use strict";

  const marker = "__GV_CANONICAL_SYNC_RUNTIME_V2__";
  if (window[marker]) return;

  window[marker] = Object.freeze({
    version: 2,
    installedAt: new Date().toISOString(),
    coordinator: "GVSync",
    compatibilityOnly: true
  });

  // state.js invokes this historical loader for compatibility. The loader
  // intentionally does not register another sync engine or mutate GVData.
  // Canonical synchronization remains exclusively owned by GVSync.
  if (window.__GV_APP_READY === true && window.GVSync?.flush) {
    window.GVSync.flush("runtime-activation").catch(() => {});
  }
})();
