/* GotaVita UI boundary — Supabase hydration + cross-device sync. */
window.GVUI = Object.freeze({
  renderAll() {
    if (typeof window.renderAll === "function") return window.renderAll();
  },
  render(view) {
    if (typeof window.renderPartial === "function") return window.renderPartial(view);
    return this.renderAll();
  },
  toast(message, type = "success") {
    if (typeof window.showToast === "function") return window.showToast(message, type);
  },
  confirm(options) {
    if (typeof window.requestConfirmation === "function") return window.requestConfirmation(options);
    return Promise.resolve(window.confirm((options && options.message) || "Are you sure?"));
  }
});

(function installSupabaseHydrationBoundary() {
  "use strict";

  const resourceStateNames = Object.freeze({
    clients: "clients", products: "products", services: "services", employees: "employees",
    orders: "orders", payments: "payments", expenses: "expenses", payroll_records: "payrollRecords",
    order_groups: "orderGroups", delivery_routes: "deliveryRoutes", order_group_items: "orderGroupItems",
    delivery_route_items: "deliveryRouteItems", daily_reports: "dailyReports", deleted_orders: "deletedOrders",
    audit_logs: "auditLog"
  });

  const cloudAliases = Object.freeze({
    payrollRecords: "payroll_records", orderGroups: "order_groups", deliveryRoutes: "delivery_routes",
    orderGroupItems: "order_group_items", deliveryRouteItems: "delivery_route_items", dailyReports: "daily_reports",
    deletedOrders: "deleted_orders", auditLog: "audit_logs"
  });

  const BASELINE_KEY = "gotavita_sync_baseline_v1";
  let hydrationPromise = null;
  let gatewayWrapped = false;
  let syncPromise = null;

  function mergePayload(payload, fallback) {
    return payload && typeof payload === "object" ? Object.assign({}, payload, fallback) : fallback;
  }

  function mapService(row) {
    return mergePayload(row?.legacy_payload, {
      id: row?.legacy_id, name: row?.name || "", category: row?.category || "",
      price: Number(row?.price) || 0, active: row?.active !== false,
      createdAt: row?.created_at, updatedAt: row?.updated_at, supabaseId: row?.id
    });
  }

  function normalizeResourceRows(resource, rows) {
    return resource === "services" ? rows.map(mapService) : rows;
  }

  function rebuildChildLinks(nextState) {
    const groups = Array.isArray(nextState.orderGroups) ? nextState.orderGroups : [];
    const routes = Array.isArray(nextState.deliveryRoutes) ? nextState.deliveryRoutes : [];
    const groupById = new Map(groups.map((group) => [String(group.id), group]));
    const routeById = new Map(routes.map((route) => [String(route.id), route]));

    for (const group of groups) if (!Array.isArray(group.orderIds)) group.orderIds = [];
    for (const route of routes) if (!Array.isArray(route.orderIds)) route.orderIds = [];

    for (const item of nextState.orderGroupItems || []) {
      const group = groupById.get(String(item.groupLegacyId ?? item.groupId ?? ""));
      const orderId = item.orderLegacyId ?? item.orderId;
      if (group && orderId != null && !group.orderIds.some((id) => String(id) === String(orderId))) group.orderIds.push(orderId);
    }
    for (const item of nextState.deliveryRouteItems || []) {
      const route = routeById.get(String(item.routeLegacyId ?? item.routeId ?? ""));
      const orderId = item.orderLegacyId ?? item.orderId;
      if (route && orderId != null && !route.orderIds.some((id) => String(id) === String(orderId))) route.orderIds.push(orderId);
    }
  }

  function getQueuedResources() {
    try {
      const queue = typeof window.getSyncQueue === "function" ? window.getSyncQueue() : [];
      return Array.isArray(queue) ? queue.filter(Boolean) : [];
    } catch (_) { return []; }
  }

  function readBaseline() {
    try {
      const raw = window.localStorage?.getItem(BASELINE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) { return null; }
  }

  function writeBaseline(snapshot, resources) {
    try {
      const baseline = {};
      for (const resource of resources) {
        const stateName = stateResourceNames[resource];
        if (stateName) baseline[stateName] = Array.isArray(snapshot?.[stateName]) ? snapshot[stateName] : [];
      }
      window.localStorage?.setItem(BASELINE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), state: baseline }));
    } catch (_) {}
  }

  function stableRows(value) {
    return JSON.stringify(Array.isArray(value) ? value : []);
  }

  function getLocallyChangedResources(snapshot, supported) {
    const baseline = readBaseline();
    if (!baseline?.state) return [];

    return supported.filter((resource) => {
      const stateName = resourceStateNames[resource];
      if (!stateName) return false;
      return stableRows(snapshot?.[stateName]) !== stableRows(baseline.state[stateName]);
    });
  }

  async function hydrateFromSupabase(original) {
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = (async () => {
      if (!window.GVAuth?.isAuthorized?.() || !original?.supportedResources ||
          typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") {
        return { hydrated: false, reason: "not-authorized-or-bridge-unavailable" };
      }

      const supported = original.supportedResources();
      if (!Array.isArray(supported) || !supported.length) return { hydrated: false, reason: "no-supported-resources" };

      const entries = await Promise.all(supported.map(async (resource) => {
        const rows = await original.selectResource(resource);
        return [resource, Array.isArray(rows) ? rows : []];
      }));
      const cloudRows = Object.fromEntries(entries);
      if (!Object.values(cloudRows).some((rows) => rows.length > 0)) return { hydrated: false, reason: "cloud-empty" };

      const nextState = window.getStateSnapshot();
      for (const [resource, rows] of Object.entries(cloudRows)) {
        const stateName = resourceStateNames[resource];
        if (stateName && rows.length) nextState[stateName] = normalizeResourceRows(resource, rows);
      }
      rebuildChildLinks(nextState);

      const now = Date.now();
      nextState._meta = Object.assign({}, nextState._meta, {
        lastUpdated: now, cloudHydratedAt: now, cloudHydrationVersion: 1,
        cloudHydrationCounts: Object.fromEntries(Object.entries(cloudRows).map(([r, rows]) => [r, rows.length]))
      });
      window.replaceState(nextState);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);
      writeBaseline(nextState, supported);

      return { hydrated: true, counts: Object.fromEntries(Object.entries(cloudRows).map(([r, rows]) => [r, rows.length])) };
    })().catch((error) => {
      console.warn("GotaVita Supabase hydration skipped; local state preserved:", error?.message || error);
      return { hydrated: false, reason: "cloud-read-failed" };
    }).then((result) => {
      if (result?.reason === "cloud-read-failed") hydrationPromise = null;
      return result;
    });

    return hydrationPromise;
  }

  function stateResourceName(resource) { return resourceStateNames[resource] || resource; }
  function cloudResourceName(resource) { return cloudAliases[resource] || resource; }

  async function syncCrossDevice(original) {
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      if (!window.GVAuth?.isAuthorized?.()) return { ok: false, status: "authentication-required" };
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, status: "offline" };
      if (typeof original?.supportedResources !== "function" || typeof original?.selectResource !== "function" || typeof original?.upsertResource !== "function") {
        return { ok: false, status: "gateway-incomplete" };
      }

      const queued = getQueuedResources();
      const snapshot = typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
      if (!snapshot || typeof snapshot !== "object") return { ok: false, status: "state-bridge-unavailable" };

      const supported = original.supportedResources();
      const locallyChanged = getLocallyChangedResources(snapshot, supported);
      const resourcesToPush = [...new Set([...queued, ...locallyChanged])];
      const pushed = [];
      const remainingQueued = [];

      for (const resource of resourcesToPush) {
        const rows = Array.isArray(snapshot[stateResourceName(resource)]) ? snapshot[stateResourceName(resource)] : [];
        if (!rows.length) {
          if (queued.includes(resource)) remainingQueued.push(resource);
          continue;
        }
        await original.upsertResource(cloudResourceName(resource), rows);
        pushed.push(resource);
      }

      const entries = await Promise.all(supported.map(async (resource) => {
        const rows = await original.selectResource(resource);
        return [resource, Array.isArray(rows) ? rows : []];
      }));
      const cloudRows = Object.fromEntries(entries);
      const nextState = window.getStateSnapshot();
      let pulled = 0;
      for (const [resource, rows] of Object.entries(cloudRows)) {
        const stateName = stateResourceName(resource);
        if (!stateName || !rows.length) continue;
        nextState[stateName] = normalizeResourceRows(resource, rows);
        pulled += rows.length;
      }
      rebuildChildLinks(nextState);

      const now = Date.now();
      nextState._meta = Object.assign({}, nextState._meta, {
        lastUpdated: now, lastSynchronizedAt: now, synchronizationVersion: 1,
        lastSynchronizedResources: pushed
      });
      window.replaceState(nextState);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);
      if (typeof window.setSyncQueue === "function") window.setSyncQueue(remainingQueued);
      writeBaseline(nextState, supported);
      if (typeof window.setSyncMeta === "function") {
        try {
          const meta = typeof window.getSyncMeta === "function" ? window.getSyncMeta() : {};
          window.setSyncMeta(Object.assign({}, meta, {
            lastSync: now, lastSyncAt: new Date(now).toISOString(), lastSyncStatus: "synced",
            pushedResources: pushed, pulledRows: pulled
          }));
        } catch (_) {}
      }
      return { ok: true, mode: "supabase", status: "synced", pushedResources: pushed, pulledRows: pulled };
    })().catch((error) => {
      console.warn("GotaVita cross-device sync failed; local queue preserved:", error?.message || error);
      return { ok: false, status: "sync-error", error: String(error?.message || error) };
    });
    try { return await syncPromise; } finally { syncPromise = null; }
  }

  function installGatewayFacade() {
    if (!window.GVData || gatewayWrapped) return;
    const original = window.GVData;
    const originalHealth = original.health;
    if (typeof originalHealth !== "function") return;

    const facade = Object.assign({}, original, {
      health: async function wrappedHealth(...args) {
        const health = await originalHealth.apply(original, args);
        if (health?.ok === true && health?.mode === "supabase") {
          const queued = getQueuedResources();
          /*
           * CRITICAL STARTUP ORDERING:
           * A local queued write is newer than the cloud snapshot. Hydrating
           * before that queue is flushed can replace a newly-created order
           * with stale cloud state; the subsequent sync would then upload the
           * stale state and permanently erase the new order. Skip hydration
           * whenever local writes are queued; GVData.sync() pushes first and
           * pulls second, preserving both outgoing and incoming changes.
           */
          if (!queued.length) await hydrateFromSupabase(original);
        }
        return health;
      },
      sync: async function wrappedSync(...args) { return syncCrossDevice(original, ...args); }
    });

    gatewayWrapped = true;
    window.GVData = Object.freeze(facade);
  }

  try { installGatewayFacade(); } catch (error) {
    console.warn("GotaVita cloud boundary could not initialize immediately:", error?.message || error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    try { installGatewayFacade(); } catch (error) {
      console.warn("GotaVita cloud boundary could not initialize:", error?.message || error);
    }
  }, { once: true });
})();
