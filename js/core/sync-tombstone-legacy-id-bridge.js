/* GotaVita Manager — JARVIS tombstone identity bridge.
 * deleted_orders rows have their own database UUID in `id` and the original
 * order identity in `legacy_id`. Cross-device deletion must match the stable
 * legacy identity, not the tombstone row UUID.
 */
(function () {
  "use strict";

  let installed = false;

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

  async function applyTombstones() {
    if (!window.GVAuth?.isAuthorized?.()) return false;
    if (!navigator.onLine) return false;
    if (!window.GVData?.selectResource || !window.getStateSnapshot || !window.replaceState) return false;

    const state = window.getStateSnapshot();
    if (!Array.isArray(state?.orders) || !state.orders.length) return false;

    const tombstones = await window.GVData.selectResource("deleted_orders");
    if (!Array.isArray(tombstones) || !tombstones.length) return false;

    const tombstoneByLegacyId = new Map();
    for (const tombstone of tombstones) {
      const id = stableId(tombstone);
      if (id) tombstoneByLegacyId.set(id, tombstone);
    }

    if (!tombstoneByLegacyId.size) return false;

    const remaining = [];
    let changed = false;

    for (const order of state.orders) {
      const tombstone = tombstoneByLegacyId.get(stableId(order));
      if (!tombstone) {
        remaining.push(order);
        continue;
      }

      if (timeOf(tombstone) >= timeOf(order)) {
        changed = true;
        continue;
      }

      remaining.push(order);
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

  function install() {
    if (installed || !window.GVSync?.flush) return;
    const original = window.GVSync;
    const originalFlush = original.flush;

    window.GVSync = Object.freeze({
      ...original,
      flush: async function (...args) {
        const result = await originalFlush.apply(original, args);
        let tombstoneApplied = false;
        try {
          tombstoneApplied = await applyTombstones();
        } catch (error) {
          console.warn("GotaVita tombstone identity bridge:", error?.message || error);
        }
        return Object.assign({}, result, { tombstoneApplied });
      },
      poll: async function (...args) {
        return this.flush(...args);
      }
    });

    installed = true;
    window.addEventListener("gv-auth-state-changed", (event) => {
      if (event?.detail?.authenticated === true) {
        setTimeout(() => window.GVSync?.flush?.().catch?.(() => {}), 100);
      }
    });
  }

  try { install(); } catch (error) {
    console.warn("GotaVita tombstone identity bridge initialization:", error?.message || error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    try { install(); } catch (_) {}
  }, { once: true });
})();
