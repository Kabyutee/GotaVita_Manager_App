/* GotaVita Manager — JARVIS cloud snapshot safety gate.
 *
 * This guard runs before the canonical conflict/reconciliation transaction.
 * A populated local collection must never be reconciled against an empty or
 * sharply reduced remote snapshot without explicit per-record deletion proof.
 *
 * P0 master data (clients, employees, products) is stricter: passive sync is
 * never allowed to infer deletion from a remote shrink. Changes to these
 * resources must originate from an explicit manager CRUD action or an
 * explicitly confirmed recovery operation.
 */
(function () {
  "use strict";

  const RATIO_THRESHOLD = 0.5;
  const P0_MASTER_RESOURCES = new Set(["clients", "employees", "products"]);
  const WRAPPED_KEY = "__GV_CLOUD_SNAPSHOT_SAFETY_V1";
  const RECOVERY_LOCK = "gotavita_cloud_recovery_lock_v1";

  function state() {
    return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
  }

  function keyOf(row, index) {
    if (!row || typeof row !== "object") return `index:${index}`;
    const value = row.legacy_id ?? row.legacyId ?? row.id;
    return value == null ? `index:${index}` : String(value).trim();
  }

  function indexRows(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => map.set(keyOf(row, index), row));
    return map;
  }

  function unsafeShrink(localRows, remoteRows, resource, remoteDeletedRows) {
    if (!Array.isArray(localRows) || localRows.length === 0) return false;
    if (!Array.isArray(remoteRows)) return true;
    if (remoteRows.length >= localRows.length) return false;

    // P0 master data is never inferred-deleted by passive sync. Even a
    // one-record shrink is blocked; manager CRUD or confirmed recovery is the
    // only legitimate path for clients/employees/products to change size.
    if (P0_MASTER_RESOURCES.has(resource)) return true;

    const localMap = indexRows(localRows);
    const remoteMap = indexRows(remoteRows);
    const missing = [...localMap.keys()].filter((id) => !remoteMap.has(id));

    if (resource === "orders") {
      const deleted = new Set((Array.isArray(remoteDeletedRows) ? remoteDeletedRows : []).map((row, index) => keyOf(row, index)));
      if (missing.length > 0 && missing.every((id) => deleted.has(id))) return false;
    }

    return remoteRows.length === 0 || remoteRows.length < localRows.length * RATIO_THRESHOLD;
  }

  async function preflight() {
    if (!window.GVData?.supportedResources || typeof window.GVData.selectResource !== "function") {
      return { ok: true, status: "gateway-unavailable" };
    }
    if (typeof window.getStateSnapshot !== "function") return { ok: true, status: "state-unavailable" };

    const current = state() || {};
    const resources = window.GVData.supportedResources().filter((resource) => resource !== "audit_logs" && resource !== "deleted_orders");
    const blocked = [];
    let deletedOrders = [];

    for (const resource of resources) {
      const stateName = resource === "payroll_records" ? "payrollRecords"
        : resource === "order_groups" ? "orderGroups"
        : resource === "delivery_routes" ? "deliveryRoutes"
        : resource === "order_group_items" ? "orderGroupItems"
        : resource === "delivery_route_items" ? "deliveryRouteItems"
        : resource === "daily_reports" ? "dailyReports"
        : resource;
      const localRows = Array.isArray(current[stateName]) ? current[stateName] : [];
      const remoteRows = await window.GVData.selectResource(resource);
      if (resource === "orders") deletedOrders = await window.GVData.selectResource("deleted_orders");
      if (unsafeShrink(localRows, remoteRows, resource, deletedOrders)) {
        blocked.push({ resource, localCount: localRows.length, remoteCount: remoteRows.length, missingCount: Math.max(0, localRows.length - remoteRows.length), priority: P0_MASTER_RESOURCES.has(resource) ? "P0" : "standard" });
      }
    }

    if (!blocked.length) return { ok: true, status: "safe", blocked: [] };

    try {
      if (typeof window.setSyncStatus === "function") window.setSyncStatus("Cloud snapshot requires review", "warning");
      localStorage.setItem("gotavita_cloud_snapshot_safety_v1", JSON.stringify({ detectedAt: new Date().toISOString(), blocked }));
    } catch (_) {}

    return { ok: false, status: "cloud-snapshot-unsafe", blocked };
  }

  async function recoverCloudFromLocal(options = {}) {
    if (options.confirm !== true) return { ok: false, status: "confirmation-required" };
    if (!window.GVData?.supportedResources || typeof window.GVData.selectResource !== "function" || typeof window.GVData.upsertResource !== "function") {
      return { ok: false, status: "gateway-unavailable" };
    }
    if (typeof window.getStateSnapshot !== "function") return { ok: false, status: "state-unavailable" };
    if (sessionStorage.getItem(RECOVERY_LOCK) === "1") return { ok: false, status: "recovery-busy" };

    sessionStorage.setItem(RECOVERY_LOCK, "1");
    try {
      const current = state() || {};
      const resources = window.GVData.supportedResources().filter((resource) => resource !== "audit_logs" && resource !== "deleted_orders");
      const written = [];
      for (const resource of resources) {
        const stateName = resource === "payroll_records" ? "payrollRecords"
          : resource === "order_groups" ? "orderGroups"
          : resource === "delivery_routes" ? "deliveryRoutes"
          : resource === "order_group_items" ? "orderGroupItems"
          : resource === "delivery_route_items" ? "deliveryRouteItems"
          : resource === "daily_reports" ? "dailyReports"
          : resource;
        const localRows = Array.isArray(current[stateName]) ? current[stateName] : [];
        if (!localRows.length) continue;
        const remoteRows = await window.GVData.selectResource(resource);
        const remoteDeleted = resource === "orders" ? await window.GVData.selectResource("deleted_orders") : [];
        if (unsafeShrink(localRows, remoteRows, resource, remoteDeleted)) {
          await window.GVData.upsertResource(resource, localRows);
          written.push({ resource, count: localRows.length });
        }
      }
      try { localStorage.removeItem("gotavita_cloud_snapshot_safety_v1"); } catch (_) {}
      if (typeof window.setSyncStatus === "function") window.setSyncStatus(written.length ? "Cloud recovery completed" : "Cloud recovery had nothing to restore", written.length ? "online" : "warning");
      return { ok: true, status: written.length ? "recovered" : "nothing-to-recover", written };
    } finally {
      sessionStorage.removeItem(RECOVERY_LOCK);
    }
  }

  function wrap() {
    if (!window.GVSync?.flush || window.GVSync[WRAPPED_KEY]) return false;
    const original = window.GVSync;
    const originalFlush = original.flush;
    async function guardedFlush(...args) {
      const gate = await preflight();
      if (!gate.ok) return { ok: false, status: gate.status, queued: original.queue?.().length || 0, safety: gate };
      return originalFlush(...args);
    }
    window.GVSync = Object.freeze({ ...original, flush: guardedFlush, poll: guardedFlush, recoverCloudFromLocal, [WRAPPED_KEY]: true });
    window.syncChangedResources = () => window.GVSync.flush();
    window.syncNow = () => window.GVSync.flush();
    return true;
  }

  function install() {
    if (wrap()) return;
    setTimeout(install, 25);
  }

  install();
  window.addEventListener("DOMContentLoaded", install, { once: true });
  window.GVCloudSnapshotSafety = Object.freeze({ preflight, recoverCloudFromLocal, unsafeShrink, p0Resources: [...P0_MASTER_RESOURCES] });
})();
