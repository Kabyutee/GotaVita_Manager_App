/* GotaVita Phase 4.5 M3 — UI Boundary
 * Central compatibility bridge for modular code to notify/render through the
 * existing UI system. Keeps current behavior while preparing a future event bus.
 */
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

/*
 * Sprint 10 Phase 3 — Supabase hydration boundary.
 * Sprint 10 Phase 4 — Cross-device synchronization boundary.
 *
 * The existing script.js startup path already awaits GVData.health() before
 * finishing initial server synchronization. We intentionally hook that single
 * cloud boundary instead of rewriting the large application file.
 *
 * Safety rules:
 * - Never hydrate or sync before manager authorization.
 * - Read every supported cloud resource before replacing local state.
 * - Empty cloud resources do not erase existing local records.
 * - Cloud read/write failures leave the local state and queue intact.
 * - Replace application state only through the existing replaceState() bridge.
 * - The gateway remains the single cloud adapter; this file only coordinates it.
 */
(function installSupabaseHydrationBoundary() {
  "use strict";

  const resourceStateNames = Object.freeze({
    clients: "clients",
    products: "products",
    services: "services",
    employees: "employees",
    orders: "orders",
    payments: "payments",
    expenses: "expenses",
    payroll_records: "payrollRecords",
    order_groups: "orderGroups",
    delivery_routes: "deliveryRoutes",
    order_group_items: "orderGroupItems",
    delivery_route_items: "deliveryRouteItems",
    daily_reports: "dailyReports",
    deleted_orders: "deletedOrders",
    audit_logs: "auditLog"
  });

  const cloudAliases = Object.freeze({
    payrollRecords: "payroll_records",
    orderGroups: "order_groups",
    deliveryRoutes: "delivery_routes",
    orderGroupItems: "order_group_items",
    deliveryRouteItems: "delivery_route_items",
    dailyReports: "daily_reports",
    deletedOrders: "deleted_orders",
    auditLog: "audit_logs"
  });

  let hydrationPromise = null;
  let gatewayWrapped = false;
  let syncPromise = null;

  function mergePayload(payload, fallback) {
    return payload && typeof payload === "object"
      ? Object.assign({}, payload, fallback)
      : fallback;
  }

  function mapService(row) {
    return mergePayload(row?.legacy_payload, {
      id: row?.legacy_id,
      name: row?.name || "",
      category: row?.category || "",
      price: Number(row?.price) || 0,
      active: row?.active !== false,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
      supabaseId: row?.id
    });
  }

  function rebuildChildLinks(nextState) {
    const groups = Array.isArray(nextState.orderGroups) ? nextState.orderGroups : [];
    const routes = Array.isArray(nextState.deliveryRoutes) ? nextState.deliveryRoutes : [];

    const groupById = new Map(groups.map((group) => [String(group.id), group]));
    const routeById = new Map(routes.map((route) => [String(route.id), route]));

    for (const group of groups) {
      if (!Array.isArray(group.orderIds)) group.orderIds = [];
    }

    for (const route of routes) {
      if (!Array.isArray(route.orderIds)) route.orderIds = [];
    }

    for (const item of nextState.orderGroupItems || []) {
      const groupId = String(item.groupLegacyId ?? item.groupId ?? "");
      const orderId = item.orderLegacyId ?? item.orderId;
      const group = groupById.get(groupId);
      if (!group || orderId == null) continue;
      if (!group.orderIds.some((id) => String(id) === String(orderId))) {
        group.orderIds.push(orderId);
      }
    }

    for (const item of nextState.deliveryRouteItems || []) {
      const routeId = String(item.routeLegacyId ?? item.routeId ?? "");
      const orderId = item.orderLegacyId ?? item.orderId;
      const route = routeById.get(routeId);
      if (!route || orderId == null) continue;
      if (!route.orderIds.some((id) => String(id) === String(orderId))) {
        route.orderIds.push(orderId);
      }
    }
  }

  function normalizeResourceRows(resource, rows) {
    if (resource === "services") return rows.map(mapService);
    return rows;
  }

  async function hydrateFromSupabase(original) {
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = (async () => {
      if (
        !window.GVAuth?.isAuthorized?.() ||
        !original?.supportedResources ||
        typeof window.getStateSnapshot !== "function" ||
        typeof window.replaceState !== "function"
      ) {
        return { hydrated: false, reason: "not-authorized-or-bridge-unavailable" };
      }

      const supported = original.supportedResources();
      if (!Array.isArray(supported) || !supported.length) {
        return { hydrated: false, reason: "no-supported-resources" };
      }

      const entries = await Promise.all(
        supported.map(async (resource) => {
          const rows = await original.selectResource(resource);
          return [resource, Array.isArray(rows) ? rows : []];
        })
      );

      const cloudRows = Object.fromEntries(entries);
      const cloudHasData = Object.values(cloudRows).some((rows) => rows.length > 0);

      if (!cloudHasData) {
        return { hydrated: false, reason: "cloud-empty" };
      }

      const nextState = window.getStateSnapshot();

      for (const [resource, rows] of Object.entries(cloudRows)) {
        const stateName = resourceStateNames[resource];
        if (!stateName || !rows.length) continue;
        nextState[stateName] = normalizeResourceRows(resource, rows);
      }

      rebuildChildLinks(nextState);

      const now = Date.now();
      nextState._meta = Object.assign({}, nextState._meta, {
        lastUpdated: now,
        cloudHydratedAt: now,
        cloudHydrationVersion: 1,
        cloudHydrationCounts: Object.fromEntries(
          Object.entries(cloudRows).map(([resource, rows]) => [resource, rows.length])
        )
      });

      window.replaceState(nextState);

      if (typeof window.writeLocalStateSnapshot === "function") {
        window.writeLocalStateSnapshot(nextState);
      }

      return {
        hydrated: true,
        counts: Object.fromEntries(
          Object.entries(cloudRows).map(([resource, rows]) => [resource, rows.length])
        )
      };
    })().catch((error) => {
      console.warn(
        "GotaVita Supabase hydration skipped; local state preserved:",
        error?.message || error
      );
      return { hydrated: false, reason: "cloud-read-failed" };
    }).then((result) => {
      // A transient cloud failure must not permanently poison the one-shot
      // hydration promise. Keep successful hydration single-install, but allow
      // the next authorized health check to retry a failed cloud read.
      if (result?.reason === "cloud-read-failed") hydrationPromise = null;
      return result;
    });

    return hydrationPromise;
  }

  function getQueuedResources() {
    try {
      if (typeof window.getSyncQueue === "function") {
        const queue = window.getSyncQueue();
        return Array.isArray(queue) ? queue.filter(Boolean) : [];
      }
    } catch (_) {}
    return [];
  }

  function stateResourceName(resource) {
    return resourceStateNames[resource] || resource;
  }

  function cloudResourceName(resource) {
    return cloudAliases[resource] || resource;
  }

  async function syncCrossDevice(original) {
    if (syncPromise) return syncPromise;

    syncPromise = (async () => {
      if (!window.GVAuth?.isAuthorized?.()) {
        return { ok: false, status: "authentication-required" };
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return { ok: false, status: "offline" };
      }

      if (
        typeof original?.supportedResources !== "function" ||
        typeof original?.selectResource !== "function" ||
        typeof original?.upsertResource !== "function"
      ) {
        return { ok: false, status: "gateway-incomplete" };
      }

      const queued = getQueuedResources();
      const snapshot =
        typeof window.getStateSnapshot === "function"
          ? window.getStateSnapshot()
          : null;

      if (!snapshot || typeof snapshot !== "object") {
        return { ok: false, status: "state-bridge-unavailable" };
      }

      const pushed = [];

      // Local queued resources win their current-device write, then we pull the
      // complete cloud surface back so every device converges on the same state.
      for (const resource of queued) {
        const cloudName = cloudResourceName(resource);
        const stateName = stateResourceName(resource);
        const rows = Array.isArray(snapshot[stateName]) ? snapshot[stateName] : [];

        if (!rows.length) continue;

        await original.upsertResource(cloudName, rows);
        pushed.push(resource);
      }

      const supported = original.supportedResources();
      const entries = await Promise.all(
        supported.map(async (resource) => {
          const rows = await original.selectResource(resource);
          return [resource, Array.isArray(rows) ? rows : []];
        })
      );

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
        lastUpdated: now,
        lastSynchronizedAt: now,
        synchronizationVersion: 1,
        lastSynchronizedResources: pushed
      });

      window.replaceState(nextState);

      if (typeof window.writeLocalStateSnapshot === "function") {
        window.writeLocalStateSnapshot(nextState);
      }

      if (
        pushed.length &&
        typeof window.setSyncQueue === "function"
      ) {
        window.setSyncQueue([]);
      }

      if (typeof window.setSyncMeta === "function") {
        try {
          const meta = typeof window.getSyncMeta === "function" ? window.getSyncMeta() : {};
          window.setSyncMeta(Object.assign({}, meta, {
            lastSync: now,
            lastSyncAt: new Date(now).toISOString(),
            lastSyncStatus: "synced",
            pushedResources: pushed,
            pulledRows: pulled
          }));
        } catch (_) {}
      }

      return {
        ok: true,
        mode: "supabase",
        status: "synced",
        pushedResources: pushed,
        pulledRows: pulled
      };
    })().catch((error) => {
      console.warn(
        "GotaVita cross-device sync failed; local queue preserved:",
        error?.message || error
      );
      return {
        ok: false,
        status: "sync-error",
        error: String(error?.message || error)
      };
    });

    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
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
          await hydrateFromSupabase(original);
        }
        return health;
      },

      sync: async function wrappedSync(...args) {
        return syncCrossDevice(original, ...args);
      }
    });

    gatewayWrapped = true;
    window.GVData = Object.freeze(facade);
  }

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      try {
        installGatewayFacade();
      } catch (error) {
        console.warn(
          "GotaVita cloud boundary could not initialize:",
          error?.message || error
        );
      }
    },
    { once: true }
  );
})();
