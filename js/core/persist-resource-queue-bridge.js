/* GotaVita Manager — durable local mutation -> sync queue bridge. */
(function () {
  "use strict";

  const RESOURCE_STATE = Object.freeze({
    orders: "orders",
    clients: "clients",
    products: "products",
    employees: "employees",
    expenses: "expenses",
    orderGroups: "orderGroups",
    dailyReports: "dailyReports",
    deletedOrders: "deletedOrders"
  });

  let installed = false;
  let lastDigest = new Map();

  function digest(value) {
    try { return JSON.stringify(value ?? []); }
    catch (_) { return ""; }
  }

  function snapshot() {
    try {
      const state = typeof window.getStateSnapshot === "function"
        ? window.getStateSnapshot()
        : null;
      if (!state) return new Map();
      return new Map(Object.entries(RESOURCE_STATE).map(([resource, stateKey]) => [
        resource,
        digest(state[stateKey])
      ]));
    } catch (_) {
      return new Map();
    }
  }

  function queueChangedResources(before, after) {
    if (typeof window.queueSyncResources !== "function") return;

    const changed = [];
    for (const resource of Object.keys(RESOURCE_STATE)) {
      if ((before.get(resource) || "") !== (after.get(resource) || "")) {
        changed.push(resource);
      }
    }

    if (!changed.length) return;

    try {
      window.queueSyncResources(changed);
    } catch (error) {
      console.warn("GotaVita mutation queue bridge:", error?.message || error);
    }
  }

  function install() {
    if (installed || typeof window.persistState !== "function") return;
    installed = true;

    lastDigest = snapshot();
    const original = window.persistState;

    window.persistState = function (...args) {
      const before = lastDigest.size ? lastDigest : snapshot();
      const after = snapshot();

      // Queue the mutation BEFORE the original persistence function can invoke
      // any background synchronization. This prevents a remote reconciliation
      // pass from observing an unqueued local mutation and restoring stale data.
      queueChangedResources(before, after);
      lastDigest = after;

      return original.apply(this, args);
    };

    window.__GV_PERSIST_RESOURCE_QUEUE_BRIDGE__ = true;
  }

  function boot() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  }

  boot();
})();
