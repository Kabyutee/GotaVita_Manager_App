const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");

async function boot({ authorized, cloudRows }) {
  let domReadyHandler = null;
  let replaceCount = 0;
  let persistCount = 0;
  let selectCount = 0;

  const supported = Object.keys(cloudRows);
  const initialState = {
    clients: [{ id: "local-client" }],
    products: [],
    services: [],
    employees: [],
    orders: [{ id: "local-order" }],
    payments: [],
    expenses: [],
    payrollRecords: [],
    orderGroups: [],
    deliveryRoutes: [],
    orderGroupItems: [],
    deliveryRouteItems: [],
    dailyReports: [],
    deletedOrders: [],
    auditLog: [],
    _meta: {}
  };

  const rawGateway = {
    supportedResources: () => supported,
    selectResource: async (resource) => {
      selectCount += 1;
      if (cloudRows[resource] instanceof Error) throw cloudRows[resource];
      return cloudRows[resource];
    },
    health: async () => ({ ok: true, mode: "supabase" })
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
    Proxy,
    Reflect,
    JSON,
    Error,
    window: {
      GVAuth: { isAuthorized: () => authorized },
      GVData: Object.freeze(rawGateway),
      getStateSnapshot: () => JSON.parse(JSON.stringify(initialState)),
      replaceState: () => { replaceCount += 1; },
      writeLocalStateSnapshot: () => { persistCount += 1; },
      addEventListener: (name, handler) => {
        if (name === "DOMContentLoaded") domReadyHandler = handler;
      }
    }
  };

  context.window.window = context.window;
  vm.runInNewContext(source, context, { filename: "ui-bridge.js" });
  assert.ok(domReadyHandler, "DOMContentLoaded hydration hook was not registered");
  domReadyHandler();

  await context.window.GVData.health();
  await context.window.GVData.health();

  return { selectCount, replaceCount, persistCount, supportedCount: supported.length };
}

(async () => {
  const cloudRows = Object.fromEntries([
    ["clients", [{ id: "cloud-client" }]],
    ["products", []],
    ["services", []],
    ["employees", []],
    ["orders", [{ id: "cloud-order" }]],
    ["payments", []],
    ["expenses", []],
    ["payroll_records", []],
    ["order_groups", []],
    ["delivery_routes", []],
    ["order_group_items", []],
    ["delivery_route_items", []],
    ["daily_reports", []],
    ["deleted_orders", []],
    ["audit_logs", []]
  ]);

  const authorized = await boot({ authorized: true, cloudRows });
  assert.equal(authorized.selectCount, authorized.supportedCount, "Hydration must read each resource once across repeated health calls");
  assert.equal(authorized.replaceCount, 1, "Hydration must install state exactly once");
  assert.equal(authorized.persistCount, 1, "Hydration must persist exactly once");

  const unauthorized = await boot({ authorized: false, cloudRows });
  assert.equal(unauthorized.selectCount, 0, "Unauthorized startup must not read cloud resources");
  assert.equal(unauthorized.replaceCount, 0, "Unauthorized startup must not replace local state");
  assert.equal(unauthorized.persistCount, 0, "Unauthorized startup must not persist hydrated state");

  const failed = await boot({
    authorized: true,
    cloudRows: { ...cloudRows, clients: new Error("RLS read blocked") }
  });
  assert.equal(failed.replaceCount, 0, "A cloud read failure must not partially replace local state");
  assert.equal(failed.persistCount, 0, "A cloud read failure must not persist partial state");

  console.log("Sprint 12 state hydration contract: PASS");
})();
