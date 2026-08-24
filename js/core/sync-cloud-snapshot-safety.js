/* GotaVita Manager — JARVIS cloud snapshot safety + P0 pull bridge. */
(function () {
  "use strict";

  const RATIO_THRESHOLD = 0.5;
  const P0_MASTER_RESOURCES = new Set(["clients", "employees", "products"]);
  const WRAPPED_KEY = "__GV_CLOUD_SNAPSHOT_SAFETY_V2";
  const RECOVERY_LOCK = "gotavita_cloud_recovery_lock_v1";
  const PULL_MS = 5000;
  let pullTimer = null;
  let pullBusy = false;

  function state() {
    return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
  }

  function keyOf(row, index) {
    if (!row || typeof row !== "object") return `index:${index}`;
    const value = row.legacy_id ?? row.legacyId ?? row.id;
    return value == null ? `index:${index}` : String(value).trim();
  }

  function rowsMap(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => map.set(keyOf(row, index), row));
    return map;
  }

  function timeOf(row) {
    const raw = row?.updatedAt ?? row?.updated_at ?? row?.createdAt ?? row?.created_at ?? null;
    const time = Date.parse(raw || "");
    return Number.isFinite(time) ? time : 0;
  }

  function rowChanged(localRow, remoteRow) {
    try {
      if (!localRow || !remoteRow) return localRow !== remoteRow;
      const local = { ...localRow };
      const remote = { ...remoteRow };
      delete local.updatedAt; delete local.updated_at; delete local.createdAt; delete local.created_at;
      delete remote.updatedAt; delete remote.updated_at; delete remote.createdAt; delete remote.created_at;
      return JSON.stringify(local) !== JSON.stringify(remote);
    } catch (_) {
      return true;
    }
  }

  function stateNameFor(resource) {
    return resource === "payroll_records" ? "payrollRecords"
      : resource === "order_groups" ? "orderGroups"
      : resource === "delivery_routes" ? "deliveryRoutes"
      : resource === "order_group_items" ? "orderGroupItems"
      : resource === "delivery_route_items" ? "deliveryRouteItems"
      : resource === "daily_reports" ? "dailyReports"
      : resource;
  }

  function unsafeShrink(localRows, remoteRows, resource, remoteDeletedRows) {
    if (!Array.isArray(localRows) || localRows.length === 0) return false;
    if (!Array.isArray(remoteRows)) return true;
    if (remoteRows.length >= localRows.length) return false;
    if (P0_MASTER_RESOURCES.has(resource)) return true;

    const localMap = rowsMap(localRows);
    const remoteMap = rowsMap(remoteRows);
    const missing = [...localMap.keys()].filter((id) => !remoteMap.has(id));
    if (resource === "orders") {
      const deleted = new Set((Array.isArray(remoteDeletedRows) ? remoteDeletedRows : []).map((row, index) => keyOf(row, index)));
      if (missing.length > 0 && missing.every((id) => deleted.has(id))) return false;
    }
    return remoteRows.length === 0 || remoteRows.length < localRows.length * RATIO_THRESHOLD;
  }

  async function preflight() {
    if (!window.GVData?.supportedResources || typeof window.GVData.selectResource !== "function") return { ok: true, status: "gateway-unavailable" };
    if (typeof window.getStateSnapshot !== "function") return { ok: true, status: "state-unavailable" };
    const current = state() || {};
    const resources = window.GVData.supportedResources().filter((resource) => resource !== "audit_logs" && resource !== "deleted_orders");
    const blocked = [];
    let deletedOrders = [];
    for (const resource of resources) {
      const localRows = Array.isArray(current[stateNameFor(resource)]) ? current[stateNameFor(resource)] : [];
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

  async function pullP0MasterData() {
    if (pullBusy) return { changed: false, blocked: false };
    if (!window.GVData?.selectResource || typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return { changed: false, blocked: false };
    if (window.GVAuth?.isAuthorized?.() !== true) return { changed: false, blocked: false };
    pullBusy = true;
    try {
      const current = state() || {};
      let changed = false;
      for (const resource of P0_MASTER_RESOURCES) {
        const stateName = stateNameFor(resource);
        const localRows = Array.isArray(current[stateName]) ? current[stateName] : [];
        const remoteRows = await window.GVData.selectResource(resource);
        if (!Array.isArray(remoteRows)) continue;

        // Never infer P0 deletions. A remote shrink is visible only as a warning.
        if (unsafeShrink(localRows, remoteRows, resource, [])) {
          try { if (typeof window.setSyncStatus === "function") window.setSyncStatus(`P0 ${resource} snapshot requires review`, "warning"); } catch (_) {}
          continue;
        }

        const localMap = rowsMap(localRows);
        const remoteMap = rowsMap(remoteRows);
        const nextRows = localRows.slice();
        for (const [id, remoteRow] of remoteMap.entries()) {
          const index = nextRows.findIndex((row, rowIndex) => keyOf(row, rowIndex) === id);
          const localRow = index >= 0 ? nextRows[index] : null;
          const remoteNewer = !localRow || timeOf(remoteRow) > timeOf(localRow);
          if (remoteNewer && rowChanged(localRow, remoteRow)) {
            if (index >= 0) nextRows[index] = remoteRow;
            else nextRows.push(remoteRow);
            changed = true;
          }
        }
        if (changed && JSON.stringify(nextRows) !== JSON.stringify(localRows)) current[stateName] = nextRows;
      }

      if (!changed) return { changed: false, blocked: false };
      current._meta = Object.assign({}, current._meta, { lastUpdated: Date.now(), lastSynchronizedAt: Date.now() });
      window.replaceState(current);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(current);
      if (typeof window.persistLocalState === "function") window.persistLocalState();
      try {
        if (typeof window.GVUI?.renderAll === "function") window.GVUI.renderAll();
        else if (typeof window.renderAll === "function") window.renderAll();
      } catch (_) {}
      if (typeof window.setSyncStatus === "function") window.setSyncStatus("P0 master data synchronized", "online");
      return { changed: true, blocked: false };
    } finally {
      pullBusy = false;
    }
  }

  async function recoverCloudFromLocal(options = {}) {
    if (options.confirm !== true) return { ok: false, status: "confirmation-required" };
    if (!window.GVData?.supportedResources || typeof window.GVData.upsertResource !== "function") return { ok: false, status: "gateway-unavailable" };
    if (typeof window.getStateSnapshot !== "function") return { ok: false, status: "state-unavailable" };
    if (sessionStorage.getItem(RECOVERY_LOCK) === "1") return { ok: false, status: "recovery-busy" };
    sessionStorage.setItem(RECOVERY_LOCK, "1");
    try {
      const current = state() || {};
      const written = [];
      for (const resource of window.GVData.supportedResources().filter((name) => name !== "audit_logs" && name !== "deleted_orders")) {
        const localRows = Array.isArray(current[stateNameFor(resource)]) ? current[stateNameFor(resource)] : [];
        if (!localRows.length) continue;
        const remoteRows = await window.GVData.selectResource(resource);
        const remoteDeleted = resource === "orders" ? await window.GVData.selectResource("deleted_orders") : [];
        if (unsafeShrink(localRows, remoteRows, resource, remoteDeleted)) {
          await window.GVData.upsertResource(resource, localRows);
          written.push({ resource, count: localRows.length });
        }
      }
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
    window.GVSync = Object.freeze({ ...original, flush: guardedFlush, poll: guardedFlush, startPolling: guardedStartPolling, recoverCloudFromLocal, [WRAPPED_KEY]: true });
    window.syncChangedResources = () => window.GVSync.flush();
    window.syncNow = () => window.GVSync.flush();
    return true;
  }

  function guardedStartPolling() {
    if (pullTimer) return;
    pullP0MasterData().catch(() => {});
    pullTimer = setInterval(() => pullP0MasterData().catch(() => {}), PULL_MS);
  }

  function install() {
    if (wrap()) guardedStartPolling();
    else setTimeout(install, 25);
  }

  install();
  window.addEventListener("DOMContentLoaded", () => { install(); pullP0MasterData().catch(() => {}); }, { once: true });
  window.addEventListener("focus", () => pullP0MasterData().catch(() => {}));
  window.addEventListener("pageshow", () => pullP0MasterData().catch(() => {}));
  window.addEventListener("gv-auth-state-changed", (event) => { if (event?.detail?.authenticated === true) pullP0MasterData().catch(() => {}); });
  window.GVCloudSnapshotSafety = Object.freeze({ preflight, recoverCloudFromLocal, unsafeShrink, pullP0MasterData, p0Resources: [...P0_MASTER_RESOURCES] });
})();
