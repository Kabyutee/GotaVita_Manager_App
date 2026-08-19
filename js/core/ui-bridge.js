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
 *
 * The existing script.js startup path already awaits GVData.health() before
 * finishing initial server synchronization. We intentionally hook that single
 * cloud boundary instead of rewriting the large application file.
 *
 * Safety rules:
 * - Never hydrate before manager authorization.
 * - Read every supported cloud resource before replacing local state.
 * - If Supabase is empty, preserve local/seed data.
 * - If any supported resource read fails, keep local data untouched.
 * - Replace application state only through the existing replaceState() bridge.
 * - Persist the hydrated snapshot locally without creating a second state store.
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

  let hydrationPromise = null;
  let gatewayWrapped = false;

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
    const groups = Array.isArray(nextState.orderGroups)
      ? nextState.orderGroups
      : [];
    const routes = Array.isArray(nextState.deliveryRoutes)
      ? nextState.deliveryRoutes
      : [];

    const groupById = new Map(
      groups.map((group) => [String(group.id), group])
    );
    const routeById = new Map(
      routes.map((route) => [String(route.id), route])
    );

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

  async function hydrateFromSupabase() {
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = (async () => {
      if (
        !window.GVAuth?.isAuthorized?.() ||
        !window.GVData?.supportedResources ||
        typeof window.getStateSnapshot !== "function" ||
        typeof window.replaceState !== "function"
      ) {
        return { hydrated: false, reason: "not-authorized-or-bridge-unavailable" };
      }

      const supported = window.GVData.supportedResources();
      if (!Array.isArray(supported) || !supported.length) {
        return { hydrated: false, reason: "no-supported-resources" };
      }

      const entries = await Promise.all(
        supported.map(async (resource) => {
          const rows = await window.GVData.selectResource(resource);
          return [resource, Array.isArray(rows) ? rows : []];
        })
      );

      const cloudRows = Object.fromEntries(entries);
      const cloudHasData = Object.values(cloudRows).some(
        (rows) => rows.length > 0
      );

      if (!cloudHasData) {
        return { hydrated: false, reason: "cloud-empty" };
      }

      const nextState = window.getStateSnapshot();

      for (const [resource, rows] of Object.entries(cloudRows)) {
        const stateName = resourceStateNames[resource];
        if (!stateName || !rows.length) continue;

        nextState[stateName] = resource === "services"
          ? rows.map(mapService)
          : rows;
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
    });

    return hydrationPromise;
  }

  function wrapGateway() {
    if (!window.GVData || gatewayWrapped) return;

    const original = window.GVData;
    const originalHealth = original.health;

    if (typeof originalHealth !== "function") return;

    const wrappedHealth = async function hydratedHealth(...args) {
      const health = await originalHealth.apply(original, args);
      if (health?.ok === true && health?.mode === "supabase") {
        await hydrateFromSupabase();
      }
      return health;
    };

    const wrappedGateway = Object.freeze({
      ...original,
      health: wrappedHealth
    });

    gatewayWrapped = true;
    window.GVData = wrappedGateway;
  }

  window.addEventListener(
    "DOMContentLoaded",
    () => {
      try {
        wrapGateway();
      } catch (error) {
        console.warn(
          "GotaVita hydration boundary could not initialize:",
          error?.message || error
        );
      }
    },
    { once: true }
  );
})();
