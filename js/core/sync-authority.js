/* GotaVita Manager — ANTI BIG BANG 4.0 authoritative sync boundary */
(function () {
  "use strict";

  function snapshot() {
    if (typeof window.getStateSnapshot === "function") {
      return window.getStateSnapshot();
    }
    return null;
  }

  function persistStateAuthoritatively() {
    try {
      if (typeof window.normalizeState === "function") window.normalizeState();
      if (typeof window.validateDataIntegrity === "function") window.validateDataIntegrity();

      const current = snapshot();
      if (typeof window.writeLocalStateSnapshot === "function" && current) {
        if (!window.writeLocalStateSnapshot(current)) {
          throw new Error("Local state could not be verified after save.");
        }
      }

      // Queue ownership is centralized here. GVData.sync() owns dirty detection,
      // cloud writes, reads, baseline updates, and queue draining.
      if (typeof window.queueSyncResources === "function" && Array.isArray(window.GV_CONFIG?.SYNC_RESOURCES)) {
        window.queueSyncResources(window.GV_CONFIG.SYNC_RESOURCES);
      }

      if (window.GVSync?.flush) {
        clearTimeout(window.__gvAuthoritativeSyncTimer);
        window.__gvAuthoritativeSyncTimer = setTimeout(() => {
          window.GVSync.flush().catch((error) => {
            console.warn("GotaVita authoritative background sync:", error?.message || error);
          });
        }, 100);
      }

      return true;
    } catch (error) {
      if (typeof window.handleAppError === "function") {
        window.handleAppError("persist-state", error, {
          userMessage: "The change could not be safely saved.",
          fallback: false
        });
      } else {
        console.error("GotaVita authoritative persist:", error);
      }
      return false;
    }
  }

  async function flushAuthoritatively() {
    if (!window.GVSync?.flush) {
      return false;
    }
    return Boolean(await window.GVSync.flush());
  }

  // Replace the legacy local-mirror persistence/sync entry points after script.js
  // has defined them, so all business modules converge on the same authority.
  window.persistState = persistStateAuthoritatively;
  window.syncChangedResources = flushAuthoritatively;
  window.syncNow = flushAuthoritatively;
  window.startSyncReliability = function () {};

  window.GVAuthoritativeSync = Object.freeze({
    persist: persistStateAuthoritatively,
    flush: flushAuthoritatively
  });
})();
