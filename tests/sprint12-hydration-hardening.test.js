const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");

(async () => {
  let domReadyHandler = null;
  let replaceCount = 0;
  let persistCount = 0;
  let selectCount = 0;
  let failNextRead = true;

  const cloudRows = {
    clients: [{ id: "cloud-client" }],
    products: [],
    services: [],
    employees: [],
    orders: [{ id: "cloud-order" }],
    payments: [],
    expenses: [],
    payroll_records: [],
    order_groups: [],
    delivery_routes: [],
    order_group_items: [],
    delivery_route_items: [],
    daily_reports: [],
    deleted_orders: [],
    audit_logs: []
  };

  const gateway = {
    supportedResources: () => Object.keys(cloudRows),
    selectResource: async (resource) => {
      selectCount += 1;
      if (failNextRead && resource === "clients") {
        failNextRead = false;
        throw new Error("transient RLS/network failure");
      }
      return cloudRows[resource];
    },
    health: async () => ({ ok: true, mode: "supabase" })
  };

  const initialState = {
    clients: [{ id: "local-client" }], products: [], services: [], employees: [],
    orders: [{ id: "local-order" }], payments: [], expenses: [], payrollRecords: [],
    orderGroups: [], deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [],
    dailyReports: [], deletedOrders: [], auditLog: [], _meta: {}
  };

  const context = {
    console, Date, Map, Object, Array, Number, String, Promise, Proxy, Reflect, JSON, Error,
    window: {
      GVAuth: { isAuthorized: () => true },
      GVData: Object.freeze(gateway),
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
  assert.equal(replaceCount, 0, "Failed hydration must not replace local state");
  assert.equal(persistCount, 0, "Failed hydration must not persist partial state");

  const readsAfterFailure = selectCount;
  await context.window.GVData.health();

  assert.ok(selectCount > readsAfterFailure, "A failed hydration must be retryable on the next health call");
  assert.equal(replaceCount, 1, "Successful retry must replace state exactly once");
  assert.equal(persistCount, 1, "Successful retry must persist state exactly once");

  await context.window.GVData.health();
  assert.equal(replaceCount, 1, "Successful hydration must remain single-install after retry");
  assert.equal(persistCount, 1, "Successful hydration must remain single-persist after retry");

  console.log("Sprint 12 hydration hardening contract: PASS");
})();
