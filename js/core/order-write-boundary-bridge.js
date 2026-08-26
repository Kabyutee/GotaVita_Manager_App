/* GotaVita Manager — durable Order mutation write-through boundary. */
(function () {
  "use strict";

  let installed = false;
  let realtimeChannel = null;
  let realtimeStarting = false;
  let canonicalGatewayPatched = false;
  const realtimeRetryMs = 500;
  const REALTIME_RESOURCES = Object.freeze({
    orders: "orders",
    clients: "clients",
    products: "products",
    employees: "employees",
    expenses: "expenses",
    order_groups: "orderGroups",
    delivery_routes: "deliveryRoutes",
    deleted_orders: "deletedOrders"
  });

  const CANONICAL_FIELDS = Object.freeze({
    clients: {
      legacy_id: "id", name: "name", client_group: "group", phone: "phone",
      address: "address", default_price: "defaultPrice", notes: "notes", active: "active",
      created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    },
    products: {
      legacy_id: "id", name: "name", category: "category", current_price: "price", active: "active",
      created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    },
    employees: {
      legacy_id: "id", name: "name", position: "position", salary_type: "salaryType", salary_rate: "salaryRate",
      schedule: "schedule", status: "status", phone: "phone", notes: "notes",
      created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    },
    orders: {
      legacy_id: "id", order_number: "orderNumber", client_legacy_id: "clientId", product_legacy_id: "productId",
      order_date: "date", status: "status", delivery_status: "deliveryStatus", gallons: "gallons",
      empty_gallons_collected: "emptyGallonsCollected", unit_price: "price", total: "total",
      created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    },
    expenses: {
      legacy_id: "id", expense_date: "date", category: "category", description: "description", amount: "amount",
      employee_legacy_id: "employeeId", is_advance: "isAdvance", created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    },
    order_groups: {
      legacy_id: "id", name: "name", group_date: "date", status: "status", created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    },
    delivery_routes: {
      legacy_id: "id", name: "name", route_date: "date", status: "status", created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    },
    deleted_orders: {
      legacy_id: "id", archived_at: "archivedAt", created_at: "createdAt", updated_at: "updatedAt", id: "supabaseId"
    }
  });

  function cloneRows(rows) {
    return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  }

  function rowId(row) {
    const value = row?.id ?? row?.legacyId ?? row?.legacy_id;
    return value != null && String(value).trim() !== "" ? String(value) : null;
  }

  function changedRows(beforeRows, afterRows) {
    const before = new Map(
      cloneRows(beforeRows)
        .map((row) => [rowId(row), row])
        .filter(([id]) => id)
    );
    return cloneRows(afterRows).filter((row) => {
      const id = rowId(row);
      if (!id) return false;
      const previous = before.get(id);
      try {
        return !previous || JSON.stringify(previous) !== JSON.stringify(row);
      } catch (_) {
        return true;
      }
    });
  }

  function explicitDeletedIds(beforeDeletedRows, afterDeletedRows) {
    const before = new Set(
      cloneRows(beforeDeletedRows).map(rowId).filter(Boolean)
    );
    return cloneRows(afterDeletedRows)
      .map(rowId)
      .filter(Boolean)
      .filter((id) => !before.has(id));
  }

  function renderSafely() {
    try {
      if (window.GVSync?.render) {
        window.GVSync.render();
        return;
      }
      if (window.GVUI?.renderAll) window.GVUI.renderAll();
      else if (typeof window.renderAll === "function") window.renderAll();
    } catch (_) {}
  }

  function canonicalizeRow(resource, raw, fallback) {
    const mapping = CANONICAL_FIELDS[resource];
    if (!mapping || !raw) return fallback;
    const next = { ...fallback };
    for (const [source, target] of Object.entries(mapping)) {
      if (Object.prototype.hasOwnProperty.call(raw, source)) {
        next[target] = raw[source];
      }
    }
    return next;
  }

  async function patchCanonicalGateway() {
    if (canonicalGatewayPatched) return true;
    const data = window.GVData;
    if (!data || typeof data.selectResource !== "function" || typeof data.getClient !== "function") return false;

    const originalSelect = data.selectResource;
    const getClient = data.getClient;
    if (originalSelect.__GV_CANONICAL_READ_PATCH__) {
      canonicalGatewayPatched = true;
      return true;
    }

    async function canonicalSelectResource(resource, options = {}) {
      const converted = await originalSelect(resource, options);
      const mapping = CANONICAL_FIELDS[resource];
      if (!mapping || !Array.isArray(converted) || !converted.length) return converted;

      try {
        const client = getClient();
        if (!client?.from) return converted;
        const { data: rawRows, error } = await client.from(resource).select("*");
        if (error || !Array.isArray(rawRows)) return converted;
        const byId = new Map(
          rawRows
            .map((raw) => [raw?.legacy_id != null ? String(raw.legacy_id) : String(raw?.id ?? ""), raw])
            .filter(([id]) => id)
        );
        return converted.map((row) => {
          const id = rowId(row);
          return canonicalizeRow(resource, byId.get(String(id)), row);
        });
      } catch (error) {
        console.warn("GotaVita canonical Supabase read overlay:", error?.message || error);
        return converted;
      }
    }

    Object.defineProperty(canonicalSelectResource, "__GV_CANONICAL_READ_PATCH__", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    window.GVData = Object.freeze({
      ...data,
      selectResource: canonicalSelectResource
    });
    canonicalGatewayPatched = true;
    return true;
  }

  async function mergeCanonicalResource(resource, targetId = null) {
    const data = window.GVData;
    if (!data || typeof data.selectResource !== "function") return false;
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;

    const stateName = REALTIME_RESOURCES[resource] || resource;
    try {
      const remoteRows = await data.selectResource(resource);
      if (!Array.isArray(remoteRows) || !remoteRows.length) return false;

      const state = window.getStateSnapshot();
      const localRows = Array.isArray(state[stateName]) ? state[stateName].slice() : [];
      const byId = new Map(localRows.map((row) => [rowId(row), row]).filter(([id]) => id));
      let changed = false;

      const rowsToApply = targetId
        ? remoteRows.filter((row) => rowId(row) === String(targetId))
        : remoteRows;

      for (const remote of rowsToApply) {
        const id = rowId(remote);
        if (!id) continue;
        const existing = byId.get(id);
        if (!existing) {
          localRows.push({ ...remote });
          byId.set(id, remote);
          changed = true;
          continue;
        }
        try {
          if (JSON.stringify(existing) !== JSON.stringify(remote)) {
            const index = localRows.findIndex((row) => rowId(row) === id);
            if (index >= 0) localRows[index] = { ...remote };
            changed = true;
          }
        } catch (_) {}
      }

      if (!changed) return false;
      state[stateName] = localRows;
      state._meta = Object.assign({}, state._meta, {
        lastUpdated: Date.now(),
        lastSynchronizedAt: Date.now(),
        lastRemoteChangedResources: [resource],
        lastRealtimeSyncAt: new Date().toISOString()
      });
      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
      renderSafely();
      return true;
    } catch (error) {
      console.warn(`GotaVita Realtime canonical merge [${resource}]:`, error?.message || error);
      return false;
    }
  }

  async function applyRealtimeDelete(resource, oldRow) {
    if (resource === "orders" || resource === "deleted_orders") {
      try {
        if (typeof window.GVOrderDeleteReconciliation?.apply === "function") {
          await window.GVOrderDeleteReconciliation.apply();
          return;
        }
      } catch (_) {}
      return;
    }

    const stateName = REALTIME_RESOURCES[resource] || resource;
    const deletedId = rowId(oldRow);
    if (!deletedId || typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return;

    try {
      const state = window.getStateSnapshot();
      const rows = Array.isArray(state[stateName]) ? state[stateName] : [];
      const next = rows.filter((row) => rowId(row) !== deletedId);
      if (next.length === rows.length) return;
      state[stateName] = next;
      state._meta = Object.assign({}, state._meta, {
        lastUpdated: Date.now(),
        lastSynchronizedAt: Date.now(),
        lastRemoteChangedResources: [resource],
        lastRealtimeSyncAt: new Date().toISOString()
      });
      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
      renderSafely();
    } catch (_) {}
  }

  const realtimePending = new Map();
  let realtimeProcessTimer = null;

  function queueRealtimeWork(resource, eventType, payload) {
    realtimePending.set(resource, { eventType, payload });
    if (realtimeProcessTimer) return;
    realtimeProcessTimer = setTimeout(async () => {
      realtimeProcessTimer = null;
      if (window.__GV_ORDER_DIRECT_WRITE_ACTIVE === true || window.__GV_SYNC_TRANSACTION_ACTIVE === true) {
        for (const [key, value] of realtimePending) queueRealtimeWork(key, value.eventType, value.payload);
        return;
      }
      const pending = [...realtimePending.entries()];
      realtimePending.clear();
      for (const [resource, item] of pending) {
        if (item.eventType === "DELETE") {
          await applyRealtimeDelete(resource, item.payload?.old || {});
          continue;
        }
        const targetId = rowId(item.payload?.new);
        let applied = await mergeCanonicalResource(resource, targetId);
        if (!applied && targetId) {
          setTimeout(() => queueRealtimeWork(resource, item.eventType, item.payload), realtimeRetryMs);
        }
      }
    }, 125);
  }

  async function stopRealtime() {
    const authClient = window.GVAuth?.getClient?.();
    if (authClient && realtimeChannel) {
      try { await authClient.removeChannel(realtimeChannel); } catch (_) {}
    }
    realtimeChannel = null;
    realtimeStarting = false;
  }

  async function startRealtime() {
    if (realtimeChannel || realtimeStarting) return;
    const auth = window.GVAuth;
    const client = auth?.getClient?.();
    if (!client || auth?.isAuthorized?.() !== true) return;

    realtimeStarting = true;
    try {
      const channel = client.channel("gotavita-canonical-sync");
      Object.keys(REALTIME_RESOURCES).forEach((resource) => {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: resource },
          (payload) => queueRealtimeWork(resource, payload?.eventType || "*", payload)
        );
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeChannel = channel;
          realtimeStarting = false;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (realtimeChannel === channel) realtimeChannel = null;
          realtimeStarting = false;
          setTimeout(() => startRealtime().catch(() => {}), realtimeRetryMs);
        }
      });
    } catch (error) {
      realtimeStarting = false;
      console.warn("GotaVita Realtime startup:", error?.message || error);
      setTimeout(() => startRealtime().catch(() => {}), realtimeRetryMs);
    }
  }

  async function mergeCanonicalOrdersIntoLocalState() {
    return mergeCanonicalResource("orders");
  }

  async function refreshOrderBaseline() {
    const integration = window.GVConflictIntegration;
    const data = window.GVData;
    if (
      !integration ||
      typeof integration.getBaseline !== "function" ||
      typeof integration.setBaseline !== "function" ||
      !data ||
      typeof data.selectResource !== "function"
    ) return;

    try {
      const remoteOrders = await data.selectResource("orders");
      if (!Array.isArray(remoteOrders)) return;
      const baseline = integration.getBaseline() || {};
      integration.setBaseline({
        ...baseline,
        orders: {
          baselineAt: new Date().toISOString(),
          rows: cloneRows(remoteOrders)
        }
      });
    } catch (error) {
      console.warn("GotaVita Order post-write baseline refresh:", error?.message || error);
    }
  }

  async function writeDelta(before, after) {
    const data = window.GVData;
    if (!data) return;

    const beforeOrders = Array.isArray(before?.orders) ? before.orders : [];
    const afterOrders = Array.isArray(after?.orders) ? after.orders : [];
    const changedOrders = changedRows(beforeOrders, afterOrders);

    if (changedOrders.length && typeof data.upsertResource === "function") {
      await data.upsertResource("orders", changedOrders);
    }

    const beforeDeleted = Array.isArray(before?.deletedOrders)
      ? before.deletedOrders
      : [];
    const afterDeleted = Array.isArray(after?.deletedOrders)
      ? after.deletedOrders
      : [];

    const changedDeleted = changedRows(beforeDeleted, afterDeleted);
    if (changedDeleted.length && typeof data.upsertResource === "function") {
      await data.upsertResource("deleted_orders", changedDeleted);
    }

    const explicitDeletes = explicitDeletedIds(beforeDeleted, afterDeleted);
    if (explicitDeletes.length && typeof data.deleteResourceByLegacyId === "function") {
      for (const id of explicitDeletes) await data.deleteResourceByLegacyId("orders", id);
    }

    await mergeCanonicalOrdersIntoLocalState();
    await refreshOrderBaseline();
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
      }
    }

    Object.defineProperty(wrapped, "__GV_ORDER_WRITE_THROUGH__", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

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
    const retry = () => {
      patchCanonicalGateway().catch(() => {});
      install();
      if (!installed || !canonicalGatewayPatched) setTimeout(retry, 50);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", retry, { once: true });
    else retry();
    window.addEventListener("gv-auth-state-changed", (event) => {
      if (event?.detail?.authenticated === true) {
        patchCanonicalGateway().catch(() => {});
        startRealtime().catch(() => {});
      } else stopRealtime().catch(() => {});
    });
    if (window.GVAuth?.isAuthorized?.()) {
      patchCanonicalGateway().catch(() => {});
      startRealtime().catch(() => {});
    }
  }

  boot();
})();