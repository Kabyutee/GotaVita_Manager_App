const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function browser(remote) {
  const storage = new Map();
  let state = { orders: [], deletedOrders: [], clients: [], products: [], services: [], employees: [], payments: [], expenses: [], payrollRecords: [], orderGroups: [], deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [], dailyReports: [] };
  const window = {};
  const context = {
    window,
    document: { activeElement: null, addEventListener() {} },
    navigator: { onLine: true },
    console,
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
    setTimeout,
    clearTimeout,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) }
  };
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
        const id = String(row.legacy_id ?? row.legacyId ?? row.id);
        const index = next.findIndex((item) => String(item.legacy_id ?? item.legacyId ?? item.id) === id);
        if (index >= 0) next[index] = clone(row); else next.push(clone(row));
      }
      remote[resource] = next;
      return clone(rows);
    },
    deleteResourceByLegacyId: async (resource, id) => {
      remote[resource] = (remote[resource] || []).filter((row) => String(row.legacy_id ?? row.legacyId ?? row.id) !== String(id));
      return [];
    }
  };
  vm.runInNewContext(source, context, { filename: "sync-manager.js" });
  return { flush: (reason) => window.GVSync.flush(reason), getState: () => clone(state), setState: (next) => { state = clone(next); } };
}

(async () => {
  const remote = { orders: [{ id: "1", legacy_id: "1", orderNumber: "0000001", status: "Paid", updatedAt: "2026-08-28T00:00:00.000Z" }], deleted_orders: [] };
  const a = browser(remote);
  const b = browser(remote);

  await a.flush("startup");
  await b.flush("startup");
  assert.equal(a.getState().orders.length, 1);
  assert.equal(b.getState().orders.length, 1);

  const created = { id: "2", legacy_id: "2", orderNumber: "0000002", status: "Unpaid", address: "E2E-A", updatedAt: "2026-08-28T00:01:00.000Z" };
  a.setState({ ...a.getState(), orders: [...a.getState().orders, created] });
  await a.flush("local-mutation");
  await b.flush("poll");
  assert.ok(b.getState().orders.some((row) => String(row.id) === "2"), "Browser B must receive a newly created Order");

  const edited = { ...created, address: "E2E-B", updatedAt: "2026-08-28T00:02:00.000Z" };
  a.setState({ ...a.getState(), orders: a.getState().orders.map((row) => String(row.id) === "2" ? edited : row) });
  await a.flush("local-mutation");
  await b.flush("poll");
  assert.equal(b.getState().orders.find((row) => String(row.id) === "2")?.address, "E2E-B");

  a.setState({ ...a.getState(), orders: a.getState().orders.filter((row) => String(row.id) !== "2") });
  await a.flush("local-mutation");
  await b.flush("poll");
  assert.equal(b.getState().orders.some((row) => String(row.id) === "2"), false, "Browser B must receive Order deletion");

  console.log("Phase 4 cross-device sync runtime verification: PASS");
})();