const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");
let queue = ["orders", "audit_logs"];
let replaced = null;
let upserts = [];
const localStorageData = new Map();

const state = {
  clients: [], products: [], services: [], employees: [],
  orders: [{ id: "local-order", total: 30 }],
  payments: [], expenses: [], payrollRecords: [], orderGroups: [],
  deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [],
  dailyReports: [], deletedOrders: [], auditLog: [{ id: "audit-1", action: "create" }], _meta: {}
};

const cloud = {
  clients: [], products: [], services: [], employees: [],
  orders: [{ id: "local-order", total: 30 }, { id: "incoming-order", total: 75 }],
  payments: [], expenses: [], payroll_records: [], order_groups: [],
  delivery_routes: [], order_group_items: [], delivery_route_items: [],
  daily_reports: [], deleted_orders: [], audit_logs: []
};

const supported = Object.keys(cloud);
const original = {
  health: async () => ({ ok: true, mode: "supabase" }),
  supportedResources: () => supported,
  selectResource: async (resource) => cloud[resource],
  upsertResource: async (resource, rows) => {
    upserts.push([resource, rows]);
    if (resource === "audit_logs") throw new Error("audit write blocked");
    cloud[resource] = rows;
    return rows;
  }
};

const context = {
  console,
  Date,
  Map,
  Object,
  Array,
  Number,
  String,
  Promise,
  JSON,
  Error,
  navigator: { onLine: true },
  window: {
    GVAuth: { isAuthorized: () => true },
    GVData: original,
    getStateSnapshot: () => JSON.parse(JSON.stringify(state)),
    replaceState: (next) => { replaced = next; },
    writeLocalStateSnapshot: () => {},
    getSyncQueue: () => [...queue],
    setSyncQueue: (next) => { queue = [...next]; },
    getSyncMeta: () => ({}),
    setSyncMeta: () => {},
    localStorage: {
      getItem: (key) => localStorageData.has(key) ? localStorageData.get(key) : null,
      setItem: (key, value) => { localStorageData.set(key, String(value)); },
      removeItem: (key) => { localStorageData.delete(key); }
    },
    addEventListener: () => {}
  }
};
context.window.window = context.window;

vm.runInNewContext(source, context, { filename: "ui-bridge.js" });

(async () => {
  const result = await context.window.GVData.sync(true);

  assert.equal(result.ok, true);
  assert.equal(result.status, "partial-sync");
  assert.equal(result.partial, true);
  assert.ok(result.failedResources.includes("audit_logs"));
  assert.ok(result.remoteChangedResources.includes("orders"));
  assert.ok(replaced.orders.some((row) => row.id === "incoming-order"), "Remote order must still reach the receiver when an unrelated resource fails");
  assert.ok(queue.includes("audit_logs"), "Failed resource must remain queued for retry");
  assert.ok(!queue.includes("orders"), "Successful order resource must not remain queued");
  assert.deepEqual(result.remainingQueued, ["audit_logs"]);

  console.log("Sprint 18 partial sync isolation contract: PASS");
})();
