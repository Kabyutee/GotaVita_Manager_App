/* GotaVita Manager — synchronization status UI boundary */
(function(){
  "use strict";

  function queue(){
    try {
      return typeof window.getSyncQueue === "function"
        ? window.getSyncQueue()
        : (window.GVSync ? window.GVSync.queue() : []);
    } catch (_) {
      return [];
    }
  }

  function meta(){
    try {
      return typeof window.getSyncMeta === "function"
        ? window.getSyncMeta()
        : {};
    } catch (_) {
      return {};
    }
  }

  function status(){
    const q = queue().length;
    const online = navigator.onLine !== false;
    const m = meta();

    if (!online) return "offline";
    if (m.lastSyncStatus === "partial-sync" || (q && m.failedResources?.length)) return "sync-error";
    return q ? "sync-pending" : "online";
  }

  function failureDetail(){
    const m = meta();
    const failed = Array.isArray(m.failedResources) ? m.failedResources : [];
    const errors = m.failedErrors && typeof m.failedErrors === "object" ? m.failedErrors : {};

    if (!failed.length) return "";

    const first = failed[0];
    return `${first}: ${String(errors[first] || "cloud write/read failed")}`;
  }

  const RESOURCE_MAP = Object.freeze({
    products: "products",
    clients: "clients",
    employees: "employees",
    orders: "orders",
    payments: "payments",
    expenses: "expenses",
    payrollRecords: "payroll_records",
    orderGroups: "order_groups",
    deliveryRoutes: "delivery_routes",
    orderGroupItems: "order_group_items",
    deliveryRouteItems: "delivery_route_items",
    dailyReports: "daily_reports",
    deletedOrders: "deleted_orders",
    auditLog: "audit_logs"
  });

  const stateName = (cloudName) => {
    const entry = Object.entries(RESOURCE_MAP).find(([, value]) => value === cloudName);
    return entry ? entry[0] : cloudName;
  };

  const clone = (value) => {
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  };

  const rowId = (row) => String(row?.id ?? row?.legacy_id ?? "");

  const rowTime = (row) => {
    const value = row?.updatedAt || row?.updated_at || row?.createdAt || row?.created_at;
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  };

  function queuedCloudResources(){
    const raw = queue();
    const values = Array.isArray(raw) ? raw : [];
    return new Set(values.map((value) => {
      const text = typeof value === "string" ? value : value?.resource || value?.entity || "";
      return RESOURCE_MAP[text] || text;
    }).filter(Boolean));
  }

  function removeQueuedResource(cloudName){
    try {
      if (typeof window.getSyncQueue !== "function" || typeof window.setSyncQueue !== "function") return;
      const current = window.getSyncQueue();
      window.setSyncQueue(current.filter((item) => {
        const text = typeof item === "string" ? item : item?.resource || item?.entity || "";
        return text !== cloudName && (RESOURCE_MAP[text] || text) !== cloudName;
      }));
    } catch (_) {}
  }

  function statesEqual(a, b){
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (_) { return false; }
  }

  async function controlledSync(originalSync, force){
    if (navigator.onLine === false) return { ok:false, status:"offline", remoteChanged:false };
    if (!window.GVData?.isConfigured?.()) return originalSync(force);
    if (!window.GVData?.requireAuthenticatedManager) return originalSync(force);

    await window.GVData.requireAuthenticatedManager();

    const snapshot = typeof window.getStateSnapshot === "function"
      ? window.getStateSnapshot()
      : (window.state || null);

    if (!snapshot || typeof snapshot !== "object") return originalSync(force);

    const queued = queuedCloudResources();
    const nextState = clone(snapshot);
    let remoteChanged = false;
    let localWrites = 0;
    const failedResources = [];

    for (const cloudName of Object.values(RESOURCE_MAP)) {
      if (!window.GVData.supportedResources?.().includes(cloudName)) continue;

      const key = stateName(cloudName);
      const localRows = Array.isArray(snapshot[key]) ? snapshot[key] : [];
      let remoteRows;

      try {
        remoteRows = await window.GVData.selectResource(cloudName);
        if (!Array.isArray(remoteRows)) remoteRows = [];
      } catch (_) {
        failedResources.push(cloudName);
        continue;
      }

      const remoteById = new Map(remoteRows.map((row) => [rowId(row), row]));
      const dirty = queued.has(cloudName);
      const writeRows = [];

      for (const row of localRows) {
        const id = rowId(row);
        const remote = remoteById.get(id);
        if (!id || !remote || rowTime(row) > rowTime(remote)) writeRows.push(row);
      }

      if (dirty && writeRows.length) {
        try {
          await window.GVData.upsertResource(cloudName, writeRows);
          localWrites += writeRows.length;
          remoteRows = await window.GVData.selectResource(cloudName);
          remoteById.clear();
          remoteRows.forEach((row) => remoteById.set(rowId(row), row));
        } catch (_) {
          failedResources.push(cloudName);
          continue;
        }
      }

      const merged = localRows.slice();
      const localIndex = new Map(merged.map((row, index) => [rowId(row), index]));

      for (const remote of remoteRows) {
        const id = rowId(remote);
        if (!id) continue;
        const index = localIndex.get(id);
        if (index == null) {
          merged.push(clone(remote));
          remoteChanged = true;
          continue;
        }

        const local = merged[index];
        if (rowTime(remote) > rowTime(local)) {
          merged[index] = clone(remote);
          if (!statesEqual(local, remote)) remoteChanged = true;
        }
      }

      if (!statesEqual(merged, localRows)) nextState[key] = merged;
      if (dirty && !failedResources.includes(cloudName)) removeQueuedResource(cloudName);
    }

    if (remoteChanged && typeof window.replaceState === "function") {
      window.replaceState(nextState);
      if (typeof window.persistState === "function") window.persistState();
    }

    const statusValue = failedResources.length
      ? (remoteChanged || localWrites ? "partial-sync" : "sync-error")
      : "synced";

    return {
      ok: failedResources.length === 0,
      status: statusValue,
      remoteChanged,
      stateChanged: remoteChanged,
      renderRequired: remoteChanged,
      localWrites,
      failedResources
    };
  }

  let syncBridgeInstalled = false;
  function installControlledSyncBridge(){
    if (syncBridgeInstalled || !window.GVData || typeof window.GVData.sync !== "function") return;

    const original = window.GVData;
    const originalSync = original.sync.bind(original);
    let inFlight = false;

    const facade = Object.assign({}, original, {
      async sync(force){
        if (inFlight) return { ok:true, status:"sync-in-flight", remoteChanged:false };
        inFlight = true;
        try { return await controlledSync(originalSync, force); }
        finally { inFlight = false; }
      }
    });

    window.GVData = Object.freeze(facade);
    syncBridgeInstalled = true;
  }

  installControlledSyncBridge();
  window.addEventListener("DOMContentLoaded", installControlledSyncBridge, { once:true });

  window.GVSyncStatus = Object.freeze({
    get: status,
    detail: failureDetail,
    label(){
      const s = status();
      if (s === "online") return "Synced ✓";
      if (s === "offline") return "Offline";
      if (s === "sync-error") {
        const detail = failureDetail();
        return detail ? `Sync blocked · ${detail}` : "Sync blocked";
      }
      return "Sync pending";
    }
  });
})();