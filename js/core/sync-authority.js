/* GotaVita Manager — ANTI BIG BANG 4.0 authoritative sync boundary */
(function () {
  "use strict";

  function snapshot() {
    return typeof getStateSnapshot === "function"
      ? getStateSnapshot()
      : null;
  }

  function persistStateAuthoritatively() {
    try {
      if (typeof normalizeState === "function") normalizeState();
      if (typeof validateDataIntegrity === "function") validateDataIntegrity();

      const current = snapshot();
      if (typeof writeLocalStateSnapshot === "function" && current) {
        if (!writeLocalStateSnapshot(current)) {
          throw new Error("Local state could not be verified after save.");
        }
      }

      // A sync transaction already owns queue draining and must not enqueue a
      // second background transaction while it is reconciling state. Doing so
      // creates a self-sustaining "Sync pending" loop after every successful
      // reconciliation. The transaction marker is set by GVSync.flush().
      if (window.__GV_SYNC_TRANSACTION_ACTIVE === true) {
        return true;
      }

      // Queue ownership is centralized here for normal business writes.
      if (typeof queueSyncResources === "function" && Array.isArray(window.GV_CONFIG?.SYNC_RESOURCES)) {
        queueSyncResources(window.GV_CONFIG.SYNC_RESOURCES);
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
      if (typeof handleAppError === "function") {
        handleAppError("persist-state", error, {
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

  function refreshVisibleSyncStatus() {
    try {
      const element = document.getElementById("syncStatus");
      const status = window.GVSyncStatus;
      if (!element || !status?.label) return;
      const label = status.label();
      element.textContent = `● ${label}`;
      element.dataset.status = status.get();
      const detail = status.detail?.();
      element.title = detail || "Storage and synchronization status";
    } catch (_) {}
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

  // Keep the status indicator sourced from the authoritative sync metadata.
  refreshVisibleSyncStatus();
  setInterval(refreshVisibleSyncStatus, 1000);
})();
