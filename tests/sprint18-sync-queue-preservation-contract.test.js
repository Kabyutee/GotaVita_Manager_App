const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");

let queue = ["orders", "expenses"];
let upserts = [];
let replaced = null;

const state = {
  orders: [{ id: "order-1", total: 30 }],
  expenses: [],
  clients: [], products: [], services: [], employees: [], payments: [], payrollRecords: [],
  orderGroups: [], deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [],
  dailyReports: [], deletedOrders: [], auditLog: [], _meta: {}
};

const cloud = {
  clients: [], products: [], services: [], employees: [], orders: [], payments: [],
  expenses: [], payroll_records: [], order_groups: [], delivery_routes: [],
  order_group_items: [], delivery_route_items: [], daily_reports: [],
  deleted_orders: [], audit_logs: []
};

const supported = Object.keys(cloud);
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
    GVData: Object.freeze({
      supportedResources: () => supported,
      upsertResource: async (resource, rows) => {
        upserts.push(resource);
        cloud[resource] = rows;
        return rows;
      },
      selectResource: async (resource) => cloud[resource],
      health: async () => ({ ok: true, mode: "supabase" })
    }),
    getStateSnapshot: () => JSON.parse(JSON.stringify(state)),
    replaceState: (next) => { replaced = next; },
    writeLocalStateSnapshot: () => {},
    getSyncQueue: () => [...queue],
    setSyncQueue: (next) => { queue = [...next]; },
    getSyncMeta: () => ({}),
    setSyncMeta: () => {},
    addEventListener: () => {}
  }
};

context.window.window = context.window;
vm.runInNewContext(source, context, { filename: "ui-bridge.js" });

(async () => {
  const result = await context.window.GVData.sync(true);

  assert.equal(result.ok, true);
  assert.ok(replaced, "Expected a successful convergence render");
  assert.ok(upserts.includes("orders"), "Expected orders to be pushed");
  assert.equal(
    queue.includes("expenses"),
    true,
    "A queued resource with an intentionally empty local collection must not be cleared just because another resource was pushed"
  );

  console.log("Sprint 18 sync queue preservation contract: PASS");
})();
