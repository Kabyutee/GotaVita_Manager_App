const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");

async function runScenario({ cloudRows, expectHydration, expectReason }) {
  let domReadyHandler = null;
  let replacedState = null;
  let persistedState = null;
  let selectedResources = [];

  const initialState = {
    clients: [{ id: "local-client" }],
    products: [],
    services: [{ id: "local-service" }],
    employees: [],
    orders: [{ id: "local-order" }],
    payments: [],
    expenses: [{ id: "local-expense" }],
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

  const supported = Object.keys(cloudRows);

  const rawGateway = {
    supportedResources: () => supported,
    selectResource: async (resource) => {
      selectedResources.push(resource);
      if (cloudRows[resource] instanceof Error) {
        throw cloudRows[resource];
      }
      return cloudRows[resource];
    },
    health: async () => ({
      ok: true,
      mode: "supabase"
    })
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
      GVAuth: {
        isAuthorized: () => true
      },
      GVData: Object.freeze(rawGateway),
      getStateSnapshot: () => JSON.parse(JSON.stringify(initialState)),
      replaceState: (next) => {
        replacedState = next;
      },
      writeLocalStateSnapshot: (next) => {
        persistedState = next;
      },
      renderAll: () => {},
      addEventListener: (name, handler) => {
        if (name === "DOMContentLoaded") domReadyHandler = handler;
      },
      confirm: () => true
    }
  };

  context.window.window = context.window;
  vm.runInNewContext(source, context, { filename: "ui-bridge.js" });

  assert.ok(domReadyHandler, "DOMContentLoaded hydration hook was not registered");
  domReadyHandler();

  const health = await context.window.GVData.health();
  assert.equal(health.ok, true);
  assert.equal(health.mode, "supabase");

  if (expectHydration) {
    assert.ok(replacedState, "Expected authoritative replaceState() to be called");
    assert.ok(persistedState, "Expected hydrated state to be persisted locally");
    assert.ok(selectedResources.length > 0, "Expected cloud resources to be selected");
    assert.equal(replacedState.clients[0].id, "cloud-client");
    assert.equal(replacedState.orders[0].id, "cloud-order");
    assert.equal(replacedState.services[0].name, "Cloud Service");
    assert.equal(replacedState.services[0].price, 55);
    assert.equal(replacedState.expenses[0].id, "local-expense");
    assert.equal(replacedState._meta.cloudHydrationVersion, 1);
  } else {
    assert.equal(replacedState, null, "Local state must remain untouched");
    assert.equal(persistedState, null, "Local snapshot must remain untouched");
  }

  if (expectReason === "cloud-read-failed") {
    assert.equal(replacedState, null);
    assert.equal(persistedState, null);
  }
}

(async () => {
  await runScenario({
    cloudRows: {
      clients: [{ id: "uuid-client", legacy_id: "cloud-client", name: "Cloud Client" }],
      products: [],
      services: [{ id: "uuid-service", legacy_id: "cloud-service", name: "Cloud Service", category: "Refill", price: 55, active: true }],
      employees: [],
      orders: [{ id: "uuid-order", legacy_id: "cloud-order", order_number: "1001", status: "Paid" }],
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
    },
    expectHydration: true
  });

  await runScenario({
    cloudRows: {
      clients: [],
      products: [],
      services: [],
      employees: [],
      orders: [],
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
    },
    expectHydration: false,
    expectReason: "cloud-empty"
  });

  await runScenario({
    cloudRows: {
      clients: new Error("RLS read blocked"),
      products: [],
      services: [],
      employees: [],
      orders: [],
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
    },
    expectHydration: false,
    expectReason: "cloud-read-failed"
  });

  console.log("Phase 3 Supabase hydration runtime verification: PASS");
})();
