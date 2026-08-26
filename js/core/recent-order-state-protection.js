/* GotaVita Manager — recent local Order state protection boundary. */
(function () {
  "use strict";

  const PROTECT_MS = 2 * 60 * 1000;
  const INSTALLED = "__GV_RECENT_ORDER_STATE_PROTECTION__";

  if (window[INSTALLED]) return;

  function idOf(row) {
    const value = row?.id ?? row?.legacyId ?? row?.legacy_id;
    return value == null ? "" : String(value).trim();
  }

  function timeOf(row) {
    const value = row?.updatedAt ?? row?.updated_at ?? row?.createdAt ?? row?.created_at;
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function cloneRow(row) {
    try { return JSON.parse(JSON.stringify(row)); }
    catch (_) { return { ...row }; }
  }

  function tombstoneMap(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const id = idOf(row);
      if (id) map.set(id, row);
    });
    return map;
  }

  function protectOrders(current, nextState) {
    const currentOrders = Array.isArray(current?.orders) ? current.orders : [];
    const incomingOrders = Array.isArray(nextState?.orders) ? nextState.orders.slice() : [];
    if (!currentOrders.length) return nextState;

    const incomingById = new Map(incomingOrders.map((row) => [idOf(row), row]).filter(([id]) => id));
    const tombstones = tombstoneMap(nextState?.deletedOrders);
    const now = Date.now();
    let changed = false;

    for (const currentRow of currentOrders) {
      const id = idOf(currentRow);
      if (!id) continue;

      const currentTime = timeOf(currentRow);
      if (!currentTime || now - currentTime > PROTECT_MS) continue;

      const tombstone = tombstones.get(id);
      if (tombstone && timeOf(tombstone) >= currentTime) continue;

      const incoming = incomingById.get(id);
      if (!incoming) {
        incomingOrders.push(cloneRow(currentRow));
        incomingById.set(id, currentRow);
        changed = true;
        continue;
      }

      const incomingTime = timeOf(incoming);
      if (currentTime > incomingTime) {
        const index = incomingOrders.findIndex((row) => idOf(row) === id);
        if (index >= 0) incomingOrders[index] = cloneRow(currentRow);
        changed = true;
      }
    }

    if (changed) nextState.orders = incomingOrders;
    return nextState;
  }

  function install() {
    if (window[INSTALLED] === true) return true;
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;

    const original = window.replaceState;
    if (original.__GV_RECENT_ORDER_STATE_PROTECTION__) {
      window[INSTALLED] = true;
      return true;
    }

    function protectedReplaceState(nextState, options) {
      try {
        const current = window.getStateSnapshot();
        const protectedState = protectOrders(current, nextState);
        return original.call(window, protectedState, options);
      } catch (error) {
        console.warn("GotaVita recent Order state protection:", error?.message || error);
        return original.call(window, nextState, options);
      }
    }

    Object.defineProperty(protectedReplaceState, "__GV_RECENT_ORDER_STATE_PROTECTION__", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    window.replaceState = protectedReplaceState;
    window[INSTALLED] = true;
    return true;
  }

  function activate() {
    if (!install()) setTimeout(activate, 25);
  }

  activate();
  window.addEventListener("DOMContentLoaded", activate, { once: true });
})();
