/* GotaVita Manager — Canonical Sync v2 runtime activation.
 *
 * Compatibility hook retained because state.js still references this path.
 * It must never create a second synchronization coordinator.
 * GVSync remains the sole owner of remote-to-state synchronization.
 */
(function () {
  "use strict";

  const installedAt = new Date().toISOString();
  const marker = "__GV_CANONICAL_SYNC_RUNTIME_V2__";

  if (window[marker]) return;

  window[marker] = Object.freeze({
    version: 2,
    installedAt,
    coordinator: "GVSync",
    legacyHydrationBlocked: true
  });

  // state.js contains a historical post-auth hydration routine. Do not let
  // that compatibility path independently commit remote rows. The actual
  // canonical hydration is performed by GVSync.flush().
  const originalSelectResource = window.GVData?.selectResource;
  if (typeof originalSelectResource === "function" && !window.__GV_CANONICAL_SELECT_GUARD__) {
    window.__GV_CANONICAL_SELECT_GUARD__ = true;
    window.GVData.selectResource = async function canonicalSelectResourceGuarded(...args) {
      try {
        const stack = String(new Error().stack || "");
        if (stack.includes("hydrateAuthorizedStateAfterAuth")) return [];
      } catch (_) {}
      return originalSelectResource.apply(this, args);
    };
  }

  if (window.__GV_APP_READY === true && window.GVSync?.flush) {
    window.GVSync.flush("runtime-activation").catch(() => {});
  }
})();
