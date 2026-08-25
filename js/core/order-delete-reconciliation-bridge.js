/* GotaVita Manager — remote order tombstones are authoritative deletion evidence. */
(function () {
  "use strict";

  function stableId(row) {
    if (!row || typeof row !== "object") return "";
    return String(row.legacy_id ?? row.legacyId ?? row.id ?? "").trim();
  }

  function timeOf(row) {
    if (!row || typeof row !== "object") return 0;
    const value = row.updatedAt ?? row.updated_at ?? row.archivedAt ?? row.archived_at ?? row.createdAt ?? row.created_at;
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  async function removeRemoteDeletedOrders() {
    if (!window.GVData?.selectResource || !window.getStateSnapshot || !window.replaceState) return false;
    if (!window.GVAuth?.isAuthorized?.()) return false;

    const state = window.getStateSnapshot();
    if (!Array.isArray(state?.orders) || !state.orders.length) return false;

    const tombstones = await window.GVData.selectResource("deleted_orders");
    if (!Array.isArray(tombstones) || !tombstones.length) return false;

    const tombstoneById = new Map();
    for (const tombstone of tombstones) {
      const id = stableId(tombstone);
      if (id) tombstoneById.set(id, tombstone);
    }

    const remaining = [];
    let changed = false;
    for (const order of state.orders) {
      const tombstone = tombstoneById.get(stableId(order));
      if (!tombstone || timeOf(tombstone) < timeOf(order)) {
        remaining.push(order);
        continue;
      }
      changed = true;
    }

    if (!changed) return false;

    state.orders = remaining;
    state._meta = Object.assign({}, state._meta, {
      lastUpdated: Date.now(),
      lastSynchronizedAt: Date.now(),
      lastRemoteChangedResources: ["orders", "deleted_orders"]
    });
    window.replaceState(state);
    if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
    try {
      if (window.GVUI?.renderAll) window.GVUI.renderAll();
      else if (typeof window.renderAll === "function") window.renderAll();
    } catch (_) {}
    return true;
  }

  window.GVOrderDeleteReconciliation = Object.freeze({
    apply: removeRemoteDeletedOrders
  });

  function install() {
    if (window.__GV_ORDER_DELETE_RECONCILIATION_BRIDGE__) return true;
    if (!window.GVConflictIntegration?.run) return false;

    const originalRun = window.GVConflictIntegration.run;
    window.GVConflictIntegration = Object.freeze({
      ...window.GVConflictIntegration,
      run: async function (...args) {
        const result = await originalRun.apply(window.GVConflictIntegration, args);
        let deletionApplied = false;
        try { deletionApplied = await removeRemoteDeletedOrders(); }
        catch (error) { console.warn("GotaVita remote order tombstone apply:", error?.message || error); }
        return Object.assign({}, result, { deletionApplied });
      }
    });

    window.__GV_ORDER_DELETE_RECONCILIATION_BRIDGE__ = true;
    return true;
  }

  function ensureInstalled() {
    if (install()) return;
    setTimeout(ensureInstalled, 100);
  }

  ensureInstalled();
})();
