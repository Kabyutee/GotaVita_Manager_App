const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");

let scheduled = null;
let calls = 0;
let remote = {};
let state = { orders: [], deletedOrders: [], clients: [], products: [], services: [], employees: [], payments: [], expenses: [], payrollRecords: [], orderGroups: [], deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [], dailyReports: [] };
const storage = new Map();
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
  setInterval: (fn, ms) => { scheduled = { fn, ms }; return 1; },
  clearInterval: () => {},
  localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) }
};

window.addEventListener = () => {};
window.getStateSnapshot = () => JSON.parse(JSON.stringify(state));
window.replaceState = (next) => { state = JSON.parse(JSON.stringify(next)); };
window.writeLocalStateSnapshot = () => true;
window.GVAuth = { isAuthorized: () => true };
window.GVUI = { renderAll() {} };
window.GVData = {
  supportedResources: () => ["orders", "deleted_orders"],
  requireAuthenticatedManager: async () => ({ authenticated: true, profile: { company_id: "company-1" } }),
  selectResource: async (resource) => JSON.parse(JSON.stringify(remote[resource] || [])),
  upsertResource: async (resource, rows) => { remote[resource] = JSON.parse(JSON.stringify(rows)); calls++; return rows; },
  deleteResourceByLegacyId: async () => { calls++; return []; }
};

vm.runInNewContext(source, context, { filename: "sync-manager.js" });

(async () => {
  window.GVSync.startPolling();
  assert.ok(scheduled, "canonical sync must own the background scheduler");
  assert.equal(scheduled.ms, 5000, "canonical sync polling must remain bounded at 5 seconds");
  assert.equal(typeof window.GVSync.request, "function", "event sources must have a single request boundary");
  await window.GVSync.flush("startup");
  const before = calls;
  await scheduled.fn();
  assert.equal(calls, before, "a clean state must not generate a write during polling");
  console.log("Sprint 12 live sync polling v2 contract: PASS");
})();