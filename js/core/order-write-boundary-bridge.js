/* GotaVita Manager — Order write-through boundary and Realtime subscription. */
(function () {
  "use strict";

  let installed = false;
  let realtimeChannel = null;
  let realtimeStarting = false;
  let remoteOrderPullTimer = null;
  let remoteOrderPullInFlight = false;
  const REALTIME_RETRY_MS = 1000;
  const REMOTE_ORDER_PULL_MS = 2000;
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

  function cloneRows(rows) {
    return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  }

  function rowId(row) {
    const value = row?.id ?? row?.legacyId ?? row?.legacy_id;
    return value != null && String(value).trim() !== "" ? String(value) : null;
  }

  function rowUpdatedMs(row) {
    const value = row?.updatedAt ?? row?.updated_at ?? row?.createdAt ?? row?.created_at ?? null;
    if (value == null || value === "") return 0;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
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
      try { return !previous || JSON.stringify(previous) !== JSON.stringify(row); }
      catch (_) { return true; }
    });
  }

  function explicitDeletedIds(beforeDeletedRows, afterDeletedRows) {
    const before = new Set(cloneRows(beforeDeletedRows).map(rowId).filter(Boolean));
    return cloneRows(afterDeletedRows)
      .map(rowId)
      .filter(Boolean)
      .filter((id) => !before.has(id));
  }

  function renderSafely() {
    try {
      if (window.GVSync?.render) return window.GVSync.render();
      if (window.GVUI?.renderAll) return window.GVUI.renderAll();
      if (typeof window.renderAll === "function") return window.renderAll();
    } catch (_) {}
    return undefined;
  }

  async function applyRealtimeDelete(resource, oldRow) {
    if (resource === "orders" || resource === "deleted_orders") {
      try { await window.GVOrderDeleteReconciliation?.apply?.(); } catch (_) {}
      return;
    }

    const stateName = REALTIME_RESOURCES[resource] || resource;
    const deletedId = rowId(oldRow);
    if (!deletedId || typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return;

    const state = window.getStateSnapshot();
    const rows = Array.isArray(state[stateName]) ? state[stateName] : [];
    const next = rows.filter((row) => rowId(row) !== deletedId);
    if (next.length === rows.length) return;

    const now = new Date().toISOString();
    state[stateName] = next;
    state._meta = Object.assign({}, state._meta, {
      lastUpdated: Date.now(),
      lastSynchronizedAt: Date.now(),
      lastRemoteChangedResources: [resource],
      lastRealtimeSyncAt: now
    });
    window.replaceState(state);
    if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
    renderSafely();
  }

  async function mergeRealtimeRow(resource, row) {
    const id = rowId(row);
    if (!id || typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;

    const stateName = REALTIME_RESOURCES[resource] || resource;
    const state = window.getStateSnapshot();
    const rows = Array.isArray(state[stateName]) ? state[stateName].slice() : [];
    const index = rows.findIndex((item) => rowId(item) === id);
    if (index < 0) rows.push({ ...row });
    else {
      try {
        if (JSON.stringify(rows[index]) === JSON.stringify(row)) return false;
      } catch (_) {}
      rows[index] = { ...row };
    }

    const now = new Date().toISOString();
    state[stateName] = rows;
    state._meta = Object.assign({}, state._meta, {
      lastUpdated: Date.now(),
      lastSynchronizedAt: Date.now(),
      lastRemoteChangedResources: [resource],
      lastRealtimeSyncAt: now
    });
    window.replaceState(state);
    if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
    renderSafely();
    return true;
  }

  async function pullRemoteOrders() {
    if (remoteOrderPullInFlight) return false;
    if (window.__GV_ORDER_DIRECT_WRITE_ACTIVE === true || window.__GV_SYNC_TRANSACTION_ACTIVE === true) return false;
    if (!navigator.onLine || window.GVAuth?.isAuthorized?.() !== true) return false;
    const data = window.GVData;
    if (!data || typeof data.selectResource !== "function") return false;
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;

    remoteOrderPullInFlight = true;
    try {
      const remoteRows = await data.selectResource("orders");
      if (!Array.isArray(remoteRows)) return false;

      const state = window.getStateSnapshot();
      const localRows = Array.isArray(state.orders) ? state.orders.slice() : [];
      const localById = new Map(localRows.map((row) => [rowId(row), row]).filter(([id]) => id));
      let changed = false;

      for (const remote of remoteRows) {
        const id = rowId(remote);
        if (!id) continue;
        const local = localById.get(id);
        if (!local) {
          localRows.push({ ...remote });
          localById.set(id, remote);
          changed = true;
          continue;
        }

        const remoteMs = rowUpdatedMs(remote);
        const localMs = rowUpdatedMs(local);
        let shouldApply = remoteMs > localMs;
        if (remoteMs === 0 && localMs === 0) {
          try { shouldApply = JSON.stringify(remote) !== JSON.stringify(local); }
          catch (_) { shouldApply = true; }
        }
        if (!shouldApply) continue;

        const index = localRows.findIndex((row) => rowId(row) === id);
        if (index >= 0) {
          localRows[index] = { ...remote };
          changed = true;
        }
      }

      if (!changed) return false;

      const now = Date.now();
      state.orders = localRows;
      state._meta = Object.assign({}, state._meta, {
        lastUpdated: now,
        lastSynchronizedAt: now,
        lastRemoteChangedResources: ["orders"],
        lastRealtimeSyncAt: new Date().toISOString(),
        lastOrderRemotePullAt: new Date().toISOString()
      });
      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
      renderSafely();
      return true;
    } catch (error) {
      console.warn("GotaVita Order remote pull:", error?.message || error);
      return false;
    } finally {
      remoteOrderPullInFlight = false;
    }
  }

  function startRemoteOrderPull() {
    if (remoteOrderPullTimer) return;
    pullRemoteOrders().catch(() => {});
    remoteOrderPullTimer = setInterval(() => pullRemoteOrders().catch(() => {}), REMOTE_ORDER_PULL_MS);
  }

  function stopRemoteOrderPull() {
    if (!remoteOrderPullTimer) return;
    clearInterval(remoteOrderPullTimer);
    remoteOrderPullTimer = null;
    remoteOrderPullInFlight = false;
  }

  const realtimePending = new Map();
  let realtimeProcessTimer = null;

  function queueRealtimeWork(resource, eventType, payload) {
    realtimePending.set(resource, { eventType, payload });
    if (realtimeProcessTimer) return;

    realtimeProcessTimer = setTimeout(async () => {
      realtimeProcessTimer = null;
      if (window.__GV_ORDER_DIRECT_WRITE_ACTIVE === true) {
        for (const [key, value] of realtimePending) queueRealtimeWork(key, value.eventType, value.payload);
        return;
      }

      const pending = [...realtimePending.entries()];
      realtimePending.clear();
      for (const [resource, item] of pending) {
        if (item.eventType === "DELETE") await applyRealtimeDelete(resource, item.payload?.old || {});
        else await mergeRealtimeRow(resource, item.payload?.new || {});
      }
    }, 100);
  }

  async function stopRealtime() {
    const client = window.GVAuth?.getClient?.();
    if (client && realtimeChannel) {
      try { await client.removeChannel(realtimeChannel); } catch (_) {}
    }
    realtimeChannel = null;
    realtimeStarting = false;
    stopRemoteOrderPull();
  }

  async function startRealtime() {
    if (realtimeChannel || realtimeStarting) return;
    const auth = window.GVAuth;
    const client = auth?.getClient?.();
    if (!client || auth?.isAuthorized?.() !== true) return;

    realtimeStarting = true;
    try {
      const channel = client.channel("gotavita-canonical-sync");
      for (const resource of Object.keys(REALTIME_RESOURCES)) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: resource },
          (payload) => queueRealtimeWork(resource, payload?.eventType || "*", payload)
        );
      }

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeChannel = channel;
          realtimeStarting = false;
          startRemoteOrderPull();
          return;
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          if (realtimeChannel === channel) realtimeChannel = null;
          realtimeStarting = false;
          startRemoteOrderPull();
          setTimeout(() => startRealtime().catch(() => {}), REALTIME_RETRY_MS);
        }
      });
    } catch (error) {
      realtimeStarting = false;
      console.warn("GotaVita Realtime startup:", error?.message || error);
      startRemoteOrderPull();
      setTimeout(() => startRealtime().catch(() => {}), REALTIME_RETRY_MS);
    }
  }

  async function refreshOrderBaseline() {
    const integration = window.GVConflictIntegration;
    const data = window.GVData;
    if (!integration?.getBaseline || !integration?.setBaseline || !data?.selectResource) return;

    try {
      const rows = await data.selectResource("orders");
      if (!Array.isArray(rows)) return;
      integration.setBaseline({
        ...integration.getBaseline(),
        orders: { baselineAt: new Date().toISOString(), rows: cloneRows(rows) }
      });
    } catch (error) {
      console.warn("GotaVita Order post-write baseline refresh:", error?.message || error);
    }
  }

  async function writeOrderDelta(before, after) {
    const data = window.GVData;
    if (!data) throw new Error("Supabase data gateway unavailable.");

    const beforeOrders = Array.isArray(before?.orders) ? before.orders : [];
    const afterOrders = Array.isArray(after?.orders) ? after.orders : [];
    const changedOrders = changedRows(beforeOrders, afterOrders);
    if (changedOrders.length && typeof data.upsertResource === "function") {
      // Every local Order mutation gets a fresh canonical timestamp at the cloud write boundary.
      // This is essential for cross-device conflict resolution: Browser B must be able to
      // distinguish an edited Order from the prior version that it already has locally.
      const updatedAt = new Date().toISOString();
      for (const order of changedOrders) {
        order.updatedAt = updatedAt;
      }
      await data.upsertResource("orders", changedOrders);
    }

    const beforeDeleted = Array.isArray(before?.deletedOrders) ? before.deletedOrders : [];
    const afterDeleted = Array.isArray(after?.deletedOrders) ? after.deletedOrders : [];
    const changedDeleted = changedRows(beforeDeleted, afterDeleted);
    if (changedDeleted.length && typeof data.upsertResource === "function") {
      await data.upsertResource("deleted_orders", changedDeleted);
    }

    const explicitDeletes = explicitDeletedIds(beforeDeleted, afterDeleted);
    if (explicitDeletes.length && typeof data.deleteResourceByLegacyId === "function") {
      for (const id of explicitDeletes) await data.deleteResourceByLegacyId("orders", id);
    }

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
        await writeOrderDelta(before, after);
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
    if (installed) return true;
    const results = ["handleOrderSubmit", "handleOrderEditSubmit", "archiveOrders"].map(wrap);
    installed = results.every(Boolean);
    if (installed) window.__GV_ORDER_WRITE_BOUNDARY_BRIDGE__ = true;
    return installed;
  }

  function boot() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const retry = () => { if (!install()) setTimeout(retry, 50); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", retry, { once: true });
    else retry();

    window.addEventListener("gv-auth-state-changed", (event) => {
      if (event?.detail?.authenticated === true) {
        startRealtime().catch(() => {});
        startRemoteOrderPull();
      } else {
        stopRealtime().catch(() => {});
      }
    });
    if (window.GVAuth?.isAuthorized?.()) {
      startRealtime().catch(() => {});
      startRemoteOrderPull();
    }
  }

  boot();
})();
