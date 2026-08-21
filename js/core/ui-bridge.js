/* GotaVita UI boundary — Supabase hydration + cross-device sync. */
function rebindDynamicOrderForms() {
  try {
    const guard = window.guardedSubmitHandler;
    const forms = [
      ["orderForm", "order-form-submit", "handleOrderSubmit"],
      ["orderEditForm", "order-edit-submit", "handleOrderEditSubmit"]
    ];

    if (typeof guard !== "function") return;

    for (const [formId, key, handlerName] of forms) {
      const form = document.getElementById(formId);
      const handler = window[handlerName];
      if (!form || typeof handler !== "function" || form.__gvSubmitBound) continue;
      form.addEventListener("submit", guard(form, key, handler));
      form.__gvSubmitBound = true;
    }
  } catch (error) {
    console.warn("GotaVita dynamic order form binding skipped:", error?.message || error);
  }
}

window.GVUI = Object.freeze({
  renderAll() {
    let result;
    if (typeof window.renderAll === "function") result = window.renderAll();
    rebindDynamicOrderForms();
    return result;
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

  function writeBaseline(snapshot, resources, preservedResources = new Set(), previousBaseline = null) {
    try {
      const baseline = {};
      for (const resource of resources) {
        const stateName = resourceStateNames[resource];
        if (!stateName) continue;

        if (preservedResources.has(resource) && previousBaseline?.state && Object.prototype.hasOwnProperty.call(previousBaseline.state, stateName)) {
          baseline[stateName] = previousBaseline.state[stateName];
        } else if (!preservedResources.has(resource)) {
          baseline[stateName] = Array.isArray(snapshot?.[stateName]) ? snapshot[stateName] : [];
        }
      }

      window.localStorage?.setItem(
        BASELINE_KEY,
        JSON.stringify({ version: 1, savedAt: Date.now(), state: baseline })
      );
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
      const baseline = readBaseline();
      const cloudIsCompletelyEmpty = !Object.values(cloudRows).some((rows) => rows.length > 0);
      if (!baseline?.state && cloudIsCompletelyEmpty) return { hydrated: false, reason: "cloud-empty" };

      const nextState = window.getStateSnapshot();
      for (const [resource, rows] of Object.entries(cloudRows)) {
        const stateName = resourceStateNames[resource];
        if (stateName) nextState[stateName] = normalizeResourceRows(resource, rows);
      }
      rebuildChildLinks(nextState);

      const now = Date.now();
      nextState._meta = Object.assign({}, nextState._meta, {
        lastUpdated: now, cloudHydratedAt: now, cloudHydrationVersion: 2,
        cloudHydrationCounts: Object.fromEntries(Object.entries(cloudRows).map(([r, rows]) => [r, rows.length]))
      });

      window.replaceState(nextState);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);
      writeBaseline(nextState, supported);

      return {
        hydrated: true,
        counts: Object.fromEntries(Object.entries(cloudRows).map(([r, rows]) => [r, rows.length]))
      };
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
      const baseline = readBaseline();
      const locallyChanged = getLocallyChangedResources(snapshot, supported);
      const resourcesToPush = baseline?.state
        ? locallyChanged
        : [...new Set([...queued, ...locallyChanged])];

      const pushed = [];
      const failedResources = [];
      const failedErrors = {};
      const remainingQueued = new Set();

      for (const resource of resourcesToPush) {
        const rows = Array.isArray(snapshot[stateResourceName(resource)]) ? snapshot[stateResourceName(resource)] : [];

        if (!rows.length) {
          if (queued.includes(resource)) remainingQueued.add(resource);
          continue;
        }

        try {
          await original.upsertResource(cloudResourceName(resource), rows);
          pushed.push(resource);
        } catch (error) {
          failedResources.push(resource);
          failedErrors[resource] = String(error?.message || error);
          remainingQueued.add(resource);
          console.warn(`GotaVita sync resource failed [${resource}]:`, error?.message || error);
        }
      }

      const entries = await Promise.all(
        supported.map(async (resource) => {
          try {
            const rows = await original.selectResource(resource);
            return [resource, Array.isArray(rows) ? rows : [], null];
          } catch (error) {
            const message = String(error?.message || error);
            failedErrors[resource] = failedErrors[resource] || message;
            return [resource, [], message];
          }
        })
      );

      const nextState = window.getStateSnapshot();
      const remoteChangedResources = [];
      let pulled = 0;
      const preservedResources = new Set(failedResources);

      for (const [resource, rows, readError] of entries) {
        const stateName = stateResourceName(resource);
        if (!stateName) continue;
        if (readError) {
          preservedResources.add(resource);
          continue;
        }
        if (failedResources.includes(resource)) continue;

        const normalizedRows = normalizeResourceRows(resource, rows);
        const localRows = Array.isArray(nextState[stateName]) ? nextState[stateName] : [];
        if (stableRows(normalizedRows) !== stableRows(localRows)) remoteChangedResources.push(resource);

        nextState[stateName] = normalizedRows;
        pulled += rows.length;
      }

      rebuildChildLinks(nextState);

      const now = Date.now();
      const partial = failedResources.length > 0 || Object.keys(failedErrors).length > 0;
      nextState._meta = Object.assign({}, nextState._meta, {
        lastUpdated: now,
        lastSynchronizedAt: now,
        synchronizationVersion: 2,
        lastSynchronizedResources: pushed,
        lastRemoteChangedResources: remoteChangedResources,
        lastSyncFailedResources: [...new Set(Object.keys(failedErrors))],
        lastSyncError: Object.keys(failedErrors).length ? failedErrors : null
      });

      window.replaceState(nextState);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);

      for (const resource of failedResources) remainingQueued.add(resource);
      if (typeof window.setSyncQueue === "function") window.setSyncQueue([...remainingQueued]);

      writeBaseline(nextState, supported, preservedResources, baseline);

      if (typeof window.setSyncMeta === "function") {
        try {
          const meta = typeof window.getSyncMeta === "function" ? window.getSyncMeta() : {};
          window.setSyncMeta(Object.assign({}, meta, {
            lastSync: now,
            lastSyncAt: new Date(now).toISOString(),
            lastSyncStatus: partial ? "partial-sync" : "synced",
            pushedResources: pushed,
            pulledRows: pulled,
            remoteChangedResources,
            failedResources: [...new Set(Object.keys(failedErrors))],
            failedErrors
          }));
        } catch (_) {}
      }

      return {
        ok: true,
        mode: "supabase",
        status: partial ? "partial-sync" : "synced",
        partial,
        pushedResources: pushed,
        pulledRows: pulled,
        failedResources: [...new Set(Object.keys(failedErrors))],
        failedErrors,
        remainingQueued: [...remainingQueued],
        remoteChangedResources,
        remoteChanged: remoteChangedResources.length > 0,
        stateChanged: remoteChangedResources.length > 0,
        renderRequired: remoteChangedResources.length > 0
      };
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
          const supported = typeof original.supportedResources === "function" ? original.supportedResources() : [];
          const snapshot = typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
          const locallyChanged = snapshot && supported.length ? getLocallyChangedResources(snapshot, supported) : [];

          if (!queued.length && locallyChanged.length === 0) {
            await hydrateFromSupabase(original);
          }
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