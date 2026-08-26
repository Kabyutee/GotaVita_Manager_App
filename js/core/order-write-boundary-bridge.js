/* GotaVita Manager — durable Order mutation write-through boundary. */
(function () {
  "use strict";

  let installed = false;

  function cloneRows(rows) {
    return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  }
  function rowId(row) { return row?.id != null ? String(row.id) : null; }
  function changedRows(beforeRows, afterRows) {
    const before = new Map(cloneRows(beforeRows).map((row) => [rowId(row), row]));
    return cloneRows(afterRows).filter((row) => {
      const id = rowId(row); if (!id) return false;
      const previous = before.get(id);
      try { return !previous || JSON.stringify(previous) !== JSON.stringify(row); }
      catch (_) { return true; }
    });
  }
  function removedIds(beforeRows, afterRows) {
    const after = new Set(cloneRows(afterRows).map(rowId));
    return cloneRows(beforeRows).map(rowId).filter(Boolean).filter((id) => !after.has(id));
  }
  async function writeDelta(before, after) {
    const data = window.GVData;
    if (!data) return;
    const beforeOrders = Array.isArray(before?.orders) ? before.orders : [];
    const afterOrders = Array.isArray(after?.orders) ? after.orders : [];
    const changedOrders = changedRows(beforeOrders, afterOrders);
    const removedOrderIds = removedIds(beforeOrders, afterOrders);
    if (changedOrders.length && typeof data.upsertResource === "function") await data.upsertResource("orders", changedOrders);
    if (removedOrderIds.length && typeof data.deleteResourceByLegacyId === "function") {
      for (const id of removedOrderIds) await data.deleteResourceByLegacyId("orders", id);
    }
    const beforeDeleted = Array.isArray(before?.deletedOrders) ? before.deletedOrders : [];
    const afterDeleted = Array.isArray(after?.deletedOrders) ? after.deletedOrders : [];
    const changedDeleted = changedRows(beforeDeleted, afterDeleted);
    if (changedDeleted.length && typeof data.upsertResource === "function") await data.upsertResource("deleted_orders", changedDeleted);
  }
  function wrap(name) {
    if (typeof window[name] !== "function") return false;
    const original = window[name];
    if (original.__GV_ORDER_WRITE_THROUGH__) return true;
    async function wrapped(...args) {
      const before = typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
      window.__GV_ORDER_DIRECT_WRITE_ACTIVE = true;
      try {
        const result = await Promise.resolve(original.apply(this, args));
        const after = typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
        await writeDelta(before, after);
        return result;
      } finally {
        window.__GV_ORDER_DIRECT_WRITE_ACTIVE = false;
        // The write-through boundary above is already authoritative for this
        // mutation. Do not immediately run a full canonical reconciliation
        // against the just-written row: that creates a read-after-write race
        // where a transiently stale remote snapshot can overwrite the local
        // mutation before the next normal sync poll confirms convergence.
        // GVSync polling remains responsible for ordinary post-write
        // reconciliation.
      }
    }
    Object.defineProperty(wrapped, "__GV_ORDER_WRITE_THROUGH__", { value: true, configurable: false, enumerable: false, writable: false });
    window[name] = wrapped;
    return true;
  }
  function install() {
    if (installed) return;
    installed = ["handleOrderSubmit", "handleOrderEditSubmit", "archiveOrders"].map(wrap).some(Boolean);
    if (installed) window.__GV_ORDER_WRITE_BOUNDARY_BRIDGE__ = true;
  }
  function boot() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const retry = () => { install(); if (!installed) setTimeout(retry, 50); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", retry, { once: true }); else retry();
  }
  boot();
})();
