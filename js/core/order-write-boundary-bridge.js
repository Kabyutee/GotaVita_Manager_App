/* GotaVita Manager — durable Order mutation write-through boundary. */
(function () {
  "use strict";

  let installed = false;

  function cloneRows(rows) {
    return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  }

  // The application ID is the stable GotaVita legacy_id used by Supabase.
  // Never key Order synchronization only by a database UUID.
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

  // Never infer deletes from a shorter/partial orders snapshot. A transiently
  // incomplete state must never delete unrelated historical Orders remotely.
  function explicitDeletedIds(beforeDeletedRows, afterDeletedRows) {
    const before = new Set(
      cloneRows(beforeDeletedRows).map(rowId).filter(Boolean)
    );
    return cloneRows(afterDeletedRows)
      .map(rowId)
      .filter(Boolean)
      .filter((id) => !before.has(id));
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

    // Deletion is authoritative only when the application creates a new
    // deletedOrders tombstone for that exact legacy ID.
    const explicitDeletes = explicitDeletedIds(beforeDeleted, afterDeleted);
    if (
      explicitDeletes.length &&
      typeof data.deleteResourceByLegacyId === "function"
    ) {
      for (const id of explicitDeletes) {
        await data.deleteResourceByLegacyId("orders", id);
      }
    }
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
