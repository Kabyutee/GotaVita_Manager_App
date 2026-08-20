/* GotaVita Manager — ANTI BIG BANG 4.0 auth/sync startup bridge */
(function () {
  "use strict";

  let inFlight = false;

  async function ensureAuthorizedForSync() {
    if (inFlight || !window.GVAuth?.requireManagerSession) return;
    inFlight = true;
    try {
      await window.GVAuth.requireManagerSession();
    } catch (_) {
      // The existing sync manager remains responsible for reporting sync/auth
      // status. This bridge only closes the startup lifecycle race.
    } finally {
      inFlight = false;
    }
  }

  // script.js has finished loading before this bridge is injected by Worker.
  // Revalidate the persisted Supabase session immediately so GVSync.poll()
  // does not observe the stale `authorized === false` startup value.
  ensureAuthorizedForSync();

  window.addEventListener("gv-auth-state-changed", () => {
    if (window.GVAuth?.isAuthorized?.() !== true) ensureAuthorizedForSync();
  });

  window.addEventListener("online", ensureAuthorizedForSync);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ensureAuthorizedForSync();
  });
})();
