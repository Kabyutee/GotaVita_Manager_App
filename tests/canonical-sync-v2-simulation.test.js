const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function makeBrowser(remote) {
  const storage = new Map();
  let state = { orders: [], clients: [], products: [], services: [], employees: [], payments: [], expenses: [], payrollRecords: [], orderGroups: [], deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [], dailyReports: [], deletedOrders: [], _meta: {} };
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
    crypto: { randomUUID: () => "test-uuid" },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) }
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
  return { flush: (...args) => window.GVSync.flush(...args), getState: () => clone(state), setState: (next) => { state = clone(next); }, storage };
}

(async () => {
  const remote = { orders: [{ id: 1, legacy_id: "1", orderNumber: "0000001", status: "Paid", address: "BASE", updatedAt: "2026-08-28T00:00:00.000Z" }], deleted_orders: [] };
  const browserA = makeBrowser(remote);
  const browserB = makeBrowser(remote);

  await browserA.flush("startup");
  await browserB.flush("startup");
  assert.equal(browserA.getState().orders.length, 1);
  assert.equal(browserB.getState().orders.length, 1);

  const created = { id: 2, legacy_id: "2", orderNumber: "0000002", status: "Unpaid", address: "SYNC-A", updatedAt: "2026-08-28T00:01:00.000Z" };
  browserA.setState({ ...browserA.getState(), orders: [...browserA.getState().orders, created] });
  await browserA.flush("local-mutation");
  assert.equal(remote.orders.length, 2, "Browser A create must reach remote canonical state");

  await browserB.flush("poll");
  assert.equal(browserB.getState().orders.some((row) => row.legacy_id === "2"), true, "Browser B must converge on Browser A create");

  const edited = { ...created, address: "SYNC-A-EDITED", updatedAt: "2026-08-28T00:02:00.000Z" };
  browserA.setState({ ...browserA.getState(), orders: browserA.getState().orders.map((row) => row.legacy_id === "2" ? edited : row) });
  await browserA.flush("local-mutation");
  await browserB.flush("poll");
  assert.equal(browserB.getState().orders.find((row) => row.legacy_id === "2")?.address, "SYNC-A-EDITED");

  browserA.setState({ ...browserA.getState(), orders: browserA.getState().orders.filter((row) => row.legacy_id !== "2") });
  await browserA.flush("local-mutation");
  assert.equal(remote.orders.some((row) => row.legacy_id === "2"), false, "Browser A delete must remove remote Order");
  assert.equal(remote.deleted_orders.some((row) => row.legacy_id === "2"), true, "Order delete must create durable tombstone");

  await browserB.flush("poll");
  assert.equal(browserB.getState().orders.some((row) => row.legacy_id === "2"), false, "Browser B must converge on Order deletion");

  // Adversarial case: the local edit is older than a remote edit, but its sync
  // detection is intentionally delayed. The row timestamp, not detection time,
  // must determine the winner.
  const remoteEdited = { id: 1, legacy_id: "1", orderNumber: "0000001", status: "Paid", address: "REMOTE-NEWER", updatedAt: "2026-08-28T00:04:00.000Z" };
  remote.orders = [remoteEdited];
  browserA.setState({ ...browserA.getState(), orders: browserA.getState().orders.map((row) => row.legacy_id === "1" ? { ...row, address: "LOCAL-OLDER", updatedAt: "2026-08-28T00:03:00.000Z" } : row) });
  await browserA.flush("delayed-local-edit");
  assert.equal(remote.orders.find((row) => row.legacy_id === "1")?.address, "REMOTE-NEWER", "newer remote edit must beat delayed stale local edit");
  assert.equal(browserA.getState().orders.find((row) => row.legacy_id === "1")?.address, "REMOTE-NEWER", "local state must converge to newer remote edit");

  console.log("Canonical sync v2 convergence simulation: PASS");
})();