/* GotaVita Manager — durable Order mutation write-through boundary. */
(function () {
  "use strict";

  let installed = false;

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

  async function mergeCanonicalOrdersIntoLocalState() {
    const data = window.GVData;
    if (!data || typeof data.selectResource !== "function") return false;
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;

    try {
      const remoteOrders = await data.selectResource("orders");
      if (!Array.isArray(remoteOrders) || !remoteOrders.length) return false;

      const state = window.getStateSnapshot();
      const localOrders = Array.isArray(state.orders) ? state.orders.slice() : [];
      const byId = new Map(localOrders.map((row) => [rowId(row), row]).filter(([id]) => id));
      let changed = false;

      for (const remote of remoteOrders) {
        const id = rowId(remote);
        if (!id) continue;
        const existing = byId.get(id);
        if (!existing) {
          localOrders.push({ ...remote });
          byId.set(id, remote);
          changed = true;
          continue;
        }
        try {
          if (JSON.stringify(existing) !== JSON.stringify(remote)) {
            const index = localOrders.findIndex((row) => rowId(row) === id);
            if (index >= 0) localOrders[index] = { ...remote };
            changed = true;
          }
        } catch (_) {}
      }

      if (!changed) return false;
      state.orders = localOrders;
      state._meta = Object.assign({}, state._meta, {
        lastUpdated: Date.now(),
        lastSynchronizedAt: Date.now(),
        lastRemoteChangedResources: ["orders"]
      });
      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
      try {
        if (window.GVUI?.renderAll) window.GVUI.renderAll();
        else if (typeof window.renderAll === "function") window.renderAll();
      } catch (_) {}
      return true;
    } catch (error) {
      console.warn("GotaVita Order originating-browser canonical merge:", error?.message || error);
      return false;
    }
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
    if (
      explicitDeletes.length &&
      typeof data.deleteResourceByLegacyId === "function"
    ) {
      for (const id of explicitDeletes) {
        await data.deleteResourceByLegacyId("orders", id);
      }
    }

    // The originating handler can successfully persist the Order remotely
    // without exposing the new row in its immediate local snapshot. Always
    // merge the canonical remote Order collection back into local state after
    // a direct Order mutation, without deleting any local Orders.
    await mergeCanonicalOrdersIntoLocalState();
    await refreshOrderBaseline();
  }

  function wrap(name) {
    if (typeof window[name] !== "function") return false;
    const original = window[name];
    if (original.__GV_ORDER_WRITE_THROUGH__) return true;

    async function wrapped(...args) {
      const before =
        typeof window.getStateSnapshot === "function"
          ? window.getStateSnapshot()
          : null;

      window.__GV_ORDER_DIRECT_WRITE_ACTIVE = true;
      try {
        const result = await Promise.resolve(original.apply(this, args));
        const after =
          typeof window.getStateSnapshot === "function"
            ? window.getStateSnapshot()
            : null;
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
    installed = [
      "handleOrderSubmit",
      "handleOrderEditSubmit",
      "archiveOrders"
    ].map(wrap).some(Boolean);
    if (installed) window.__GV_ORDER_WRITE_BOUNDARY_BRIDGE__ = true;
  }

  function boot() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const retry = () => {
      install();
      if (!installed) setTimeout(retry, 50);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", retry, { once: true });
    } else {
      retry();
    }
  }

  boot();
})();