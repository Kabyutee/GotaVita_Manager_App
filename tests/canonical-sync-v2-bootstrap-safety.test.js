const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");
const clone = (value) => JSON.parse(JSON.stringify(value));

function makeBrowser(remote, initialState) {
  const storage = new Map();
  let state = clone(initialState);
  const window = {};
  const context = {
    window,
    document: { activeElement: null, addEventListener() {} },
    navigator: { onLine: true },
    console,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Object,
    Array,
    Map,
    Set,
    Promise,
    String,
    Number,
    Boolean,
    Error,
    crypto: { randomUUID: () => "bootstrap-test-id" },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    }
  };
  window.localStorage = context.localStorage;
  window.addEventListener = () => {};
  window.getStateSnapshot = () => clone(state);
  window.replaceState = (next) => { state = clone(next); };
  window.writeLocalStateSnapshot = () => true;
  window.GVAuth = { isAuthorized: () => true };
  window.GVUI = { renderAll() {} };
  window.GVData = {
    supportedResources: () => ["orders", "deleted_orders"],
    requireAuthenticatedManager: async () => ({ authenticated: true, profile: { company_id: "company-1" } }),
    selectResource: async (resource) => clone(remote[resource] || []),
    upsertResource: async (resource, rows) => {
      const next = remote[resource] ? remote[resource].slice() : [];
      for (const row of rows) {
        const key = String(row.legacy_id ?? row.legacyId ?? row.id);
        const index = next.findIndex((item) => String(item.legacy_id ?? item.legacyId ?? item.id) === key);
        if (index >= 0) next[index] = clone(row); else next.push(clone(row));
      }
      remote[resource] = next;
      return clone(rows);
    },
    deleteResourceByLegacyId: async (resource, legacyId) => {
      remote[resource] = (remote[resource] || []).filter((row) => String(row.legacy_id ?? row.legacyId ?? row.id) !== String(legacyId));
      return [];
    }
  };
  vm.runInNewContext(source, context, { filename: "sync-manager.js" });
  return { flush: (...args) => window.GVSync.flush(...args), getState: () => clone(state), storage };
}

(async () => {
  const remote = {
    orders: [{ id: 1, legacy_id: "1", orderNumber: "0000001", address: "REMOTE-BASE", updatedAt: "2026-08-28T00:01:00.000Z" }],
    deleted_orders: []
  };
  const local = {
    orders: [{ id: 1, legacy_id: "1", orderNumber: "0000001", address: "LOCAL-NEWER", updatedAt: "2026-08-28T00:02:00.000Z" }],
    clients: [], products: [], services: [], employees: [], payments: [], expenses: [], payrollRecords: [],
    orderGroups: [], deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [], dailyReports: [], deletedOrders: [], _meta: {}
  };
  const browser = makeBrowser(remote, local);
  const result = await browser.flush("startup");

  assert.equal(result.ok, true, "bootstrap must succeed");
  assert.equal(remote.orders.find((row) => row.legacy_id === "1")?.address, "LOCAL-NEWER", "newer local edit must not be silently overwritten during first-run bootstrap");
  assert.equal(browser.getState().orders.find((row) => row.legacy_id === "1")?.address, "LOCAL-NEWER", "application state must retain the newer local edit after bootstrap");

  console.log("Canonical sync v2 bootstrap safety simulation: PASS");
})();
