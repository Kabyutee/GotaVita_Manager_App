/* GotaVita Manager — Canonical preservation bridge
 *
 * Reuses the existing Universal Canonical Synchronization resolution plan.
 * Any row already classified as `preserve-local` (remote missing, no deletion
 * evidence) is promoted to Supabase instead of remaining local-only.
 * This establishes the shared cloud baseline without introducing a second
 * conflict-resolution algorithm.
 */
(function () {
  "use strict";

  const RUN_KEY = "gotavita_canonical_preservation_bridge_v1";
  let inFlight = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function stateSnapshot() {
    return typeof window.getStateSnapshot === "function"
      ? window.getStateSnapshot()
      : null;
  }

  function resourceStateName(resource) {
    return window.GVConflictIntegration?.resourceStateName?.(resource) || resource;
  }

  function resourceCloudName(resource) {
    return window.GVConflictIntegration?.resourceCloudName?.(resource) || resource;
  }

  async function promotePreservedRows() {
    if (inFlight || !navigator.onLine || window.location.protocol === "file:") {
      return { ok: false, status: "unavailable" };
    }

    if (window.GVAuth?.isAuthorized?.() !== true) {
      return { ok: false, status: "unauthorized" };
    }

    const integration = window.GVConflictIntegration;
    const gateway = window.GVData;
    if (!integration?.buildResolutionPlan || !gateway?.selectResource || !gateway?.upsertResource) {
      return { ok: false, status: "unavailable" };
    }

    const state = stateSnapshot();
    if (!state) return { ok: false, status: "no-state" };

    inFlight = true;
    try {
      const resources = integration.supportedResources?.() || [];
      const promoted = [];

      for (const resource of resources) {
        if (resource === "auditLog" || resource === "audit_logs") continue;

        const stateName = resourceStateName(resource);
        const cloudName = resourceCloudName(resource);
        const localRows = Array.isArray(state[stateName]) ? state[stateName] : [];
        if (!localRows.length) continue;

        const remoteRows = await gateway.selectResource(cloudName);
        const localDeletedRows = cloudName === "orders" ? (state.deletedOrders || []) : [];
        const remoteDeletedRows = cloudName === "orders"
          ? ((await gateway.selectResource("deleted_orders")) || [])
          : [];

        const decisions = integration.buildResolutionPlan(
          resource,
          localRows,
          Array.isArray(remoteRows) ? remoteRows : [],
          localDeletedRows,
          remoteDeletedRows
        );

        for (const decision of decisions) {
          if (decision.action !== "preserve-local" || !decision.local) continue;
          await gateway.upsertResource(cloudName, [decision.local]);
          promoted.push({ resource: cloudName, id: decision.id });
        }
      }

      try {
        localStorage.setItem(RUN_KEY, new Date().toISOString());
      } catch (_) {}

      if (promoted.length && typeof window.setSyncStatus === "function") {
        window.setSyncStatus(`Synced · ${promoted.length} local baseline record(s) promoted`, "online");
      }

      return { ok: true, status: "promoted", promoted };
    } finally {
      inFlight = false;
    }
  }

  async function runAfterCanonicalSync() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (window.GVConflictIntegration?.run && window.GVData?.selectResource) break;
      await sleep(250);
    }
    if (!window.GVConflictIntegration?.run) return;

    try {
      await window.GVConflictIntegration.run(true);
      const result = await promotePreservedRows();
      if (result.ok && typeof window.GVSync?.flush === "function") {
        await window.GVSync.flush();
      }
      if (result.promoted?.length && typeof window.renderAll === "function") {
        window.renderAll();
      }
    } catch (error) {
      console.warn("GotaVita canonical preservation:", error?.message || error);
    }
  }

  window.GVCanonicalPreservation = Object.freeze({ promotePreservedRows });

  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) {
      setTimeout(runAfterCanonicalSync, 250);
    }
  });

  const runWhenReady = () => {
    setTimeout(() => {
      if (window.GVAuth?.isAuthorized?.() === true) runAfterCanonicalSync();
    }, 500);
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", runWhenReady, { once: true });
  } else {
    runWhenReady();
  }
})();
