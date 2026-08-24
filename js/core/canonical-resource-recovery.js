/* GotaVita Manager — Canonical Resource Recovery Guard
 *
 * Uses the existing GVData gateway and canonical resource/state maps.
 * A failure in one resource must never prevent other business resources
 * from hydrating into the in-memory application state.
 */
(function () {
  "use strict";

  const RECOVERY_LOCK = "gotavita_canonical_resource_recovery_v1";

  async function recover() {
    if (window.__GV_CANONICAL_RESOURCE_RECOVERY_RUNNING === true) return { ok: false, status: "locked" };
    if (!navigator.onLine || window.location.protocol === "file:") return { ok: false, status: "offline-or-local" };
    if (window.GVData?.isConfigured?.() !== true) return { ok: false, status: "not-configured" };
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return { ok: false, status: "state-unavailable" };

    window.__GV_CANONICAL_RESOURCE_RECOVERY_RUNNING = true;
    try {
      await window.GVData.requireAuthenticatedManager();
      const state = window.getStateSnapshot();
      const maps = window.GVConflictIntegration;
      if (!state || !maps?.supportedResources || !maps?.resourceCloudName || !maps?.resourceStateName) {
        return { ok: false, status: "canonical-maps-unavailable" };
      }

      const results = [];
      let changed = false;
      for (const resource of maps.supportedResources()) {
        const cloudName = maps.resourceCloudName(resource);
        const stateName = maps.resourceStateName(cloudName);
        try {
          const remoteRows = await window.GVData.selectResource(cloudName);
          const remote = Array.isArray(remoteRows) ? remoteRows : [];
          const local = Array.isArray(state[stateName]) ? state[stateName] : [];

          // Recovery is additive only. Never erase populated local state because
          // a remote read returned empty or failed. Canonical reconciliation
          // remains responsible for authoritative conflict resolution.
          if (remote.length > 0 && (local.length === 0 || remote.length > local.length)) {
            state[stateName] = remote;
            changed = true;
            results.push({ resource, stateName, status: "hydrated", count: remote.length });
          } else {
            results.push({ resource, stateName, status: "unchanged", count: local.length });
          }
        } catch (error) {
          // One broken adapter/read must not block every other resource.
          results.push({ resource, stateName, status: "failed", error: error?.message || String(error) });
        }
      }

      if (changed) {
        const now = Date.now();
        state._meta = Object.assign({}, state._meta, {
          lastUpdated: now,
          lastSynchronizedAt: now,
          canonicalRecoveryAt: now
        });
        window.replaceState(state);
        if (typeof window.persistState === "function") window.persistState();
        if (typeof window.renderAll === "function") window.renderAll();
        else if (window.GVUI?.renderAll) window.GVUI.renderAll();
      }

      window.__GV_CANONICAL_RESOURCE_RECOVERY_RESULT = results;
      return { ok: true, status: changed ? "recovered" : "unchanged", results };
    } finally {
      window.__GV_CANONICAL_RESOURCE_RECOVERY_RUNNING = false;
    }
  }

  window.GVCanonicalResourceRecovery = Object.freeze({ recover });
})();
