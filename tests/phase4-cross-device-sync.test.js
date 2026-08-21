const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");

async function runScenario({ queued, cloud, expectError = false }) {
  let domReadyHandler = null;
  let replacedState = null;
  let persistedState = null;
  let queue = [...queued];
  let syncMeta = {};
  const upserts = [];

  const initialState = {
    clients: [{ id: "local-client" }],
    products: [],
    services: [],
    employees: [],
    orders: [{ id: "local-order", total: 30 }],
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

  const supported = Object.keys(cloud);
  const currentState = () => JSON.parse(JSON.stringify(initialState));

  const rawGateway = {
    supportedResources: () => supported,
    upsertResource: async (resource, rows) => {
      if (cloud[resource] instanceof Error) throw cloud[resource];
      upserts.push({ resource, rows });
      cloud[resource] = rows;
      return rows;
    },
    selectResource: async (resource) => {
      if (cloud[resource] instanceof Error) throw cloud[resource];
      return cloud[resource];
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
    JSON,
    Error,
    window: {
      GVAuth: { isAuthorized: () => true },
      GVData: Object.freeze(rawGateway),
      getStateSnapshot: currentState,
      replaceState: (next) => { replacedState = next; },
      writeLocalStateSnapshot: (next) => { persistedState = next; },
      getSyncQueue: () => [...queue],
      setSyncQueue: (next) => { queue = [...next]; },
      getSyncMeta: () => ({ ...syncMeta }),
      setSyncMeta: (next) => { syncMeta = { ...next }; },
      addEventListener: (name, handler) => {
        if (name === "DOMContentLoaded") domReadyHandler = handler;
      }
    },
    navigator: { onLine: true }
  };

  context.window.window = context.window;
  vm.runInNewContext(source, context, { filename: "ui-bridge.js" });
  assert.ok(domReadyHandler, "DOMContentLoaded hook missing");
  domReadyHandler();

  const result = await context.window.GVData.sync(true);

  if (expectError) {
    // ANTI BIG BANG partial-sync contract: one failed resource must remain
    // queued for retry, while the synchronization cycle itself remains usable.
    assert.equal(result.ok, true);
    assert.equal(result.status, "partial-sync");
    assert.equal(result.partial, true);
    assert.equal(queue.length, queued.length);
    assert.ok(result.failedResources.includes("orders"));
    assert.ok(replacedState, "Partial synchronization must still converge readable resources");
    assert.ok(persistedState, "Partial synchronization must persist readable resources");
    assert.equal(syncMeta.lastSyncStatus, "partial-sync");
    return;
  }

  assert.equal(result.ok, true);
  assert.equal(result.status, "synced");
  assert.equal(queue.length, 0);
  assert.equal(upserts.length, queued.length);
  assert.ok(replacedState, "Expected replaceState() during convergence");
  assert.ok(persistedState, "Expected local persistence after convergence");
  assert.equal(replacedState.clients[0].id, "remote-client");
  assert.equal(replacedState.orders[0].id, "local-order");
  assert.equal(syncMeta.lastSyncStatus, "synced");
}

(async () => {
  await runScenario({
    queued: ["orders"],
    cloud: {
      clients: [{ id: "remote-client" }],
      products: [], services: [], employees: [], orders: [], payments: [], expenses: [],
      payroll_records: [], order_groups: [], delivery_routes: [], order_group_items: [],
      delivery_route_items: [], daily_reports: [], deleted_orders: [], audit_logs: []
    }
  });

  await runScenario({
    queued: ["orders"],
    cloud: {
      clients: [], products: [], services: [], employees: [],
      orders: new Error("RLS write blocked"), payments: [], expenses: [], payroll_records: [],
      order_groups: [], delivery_routes: [], order_group_items: [], delivery_route_items: [],
      daily_reports: [], deleted_orders: [], audit_logs: []
    },
    expectError: true
  });

  console.log("Phase 4 cross-device sync runtime verification: PASS");
})();
