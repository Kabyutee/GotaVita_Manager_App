const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");

async function runScenario() {
  let domReadyHandler = null;
  let replacedState = null;
  let queue = ["orders"];
  let syncMeta = {};
  const cloud = {
    clients: [{ id: "remote-client" }],
    products: [], services: [], employees: [],
    orders: [], payments: [], expenses: [], payroll_records: [],
    order_groups: [], delivery_routes: [], order_group_items: [],
    delivery_route_items: [], daily_reports: [], deleted_orders: [], audit_logs: []
  };
  const upserts = [];

  const initialState = {
    clients: [{ id: "local-client" }],
    products: [], services: [], employees: [],
    orders: [{ id: "local-order", total: 30 }],
    payments: [], expenses: [], payrollRecords: [],
    orderGroups: [], deliveryRoutes: [], orderGroupItems: [],
    deliveryRouteItems: [], dailyReports: [], deletedOrders: [], auditLog: [], _meta: {}
  };

  const context = {
    console,
    Date, Map, Object, Array, Number, String, Promise, JSON, Error,
    window: {
      GVAuth: { isAuthorized: () => true },
      GVData: Object.freeze({
        supportedResources: () => Object.keys(cloud),
        upsertResource: async (resource, rows) => {
          upserts.push(resource);
          cloud[resource] = rows;
          return rows;
        },
        selectResource: async (resource) => cloud[resource],
        health: async () => ({ ok: true, mode: "supabase" })
      }),
      getStateSnapshot: () => JSON.parse(JSON.stringify(initialState)),
      replaceState: (next) => { replacedState = next; },
      writeLocalStateSnapshot: () => {},
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
  assert.ok(domReadyHandler);
  domReadyHandler();

  const result = await context.window.GVData.sync(true);

  assert.equal(result.ok, true);
  assert.equal(result.status, "synced");
  assert.deepEqual(upserts, ["orders"], "Only queued resources may be pushed from the local state");
  assert.equal(replacedState.clients[0].id, "remote-client", "Unqueued resources converge from cloud state");
  assert.equal(replacedState.orders[0].id, "local-order", "Queued resources remain authoritative from local state after push");
  assert.equal(queue.length, 0, "Queue clears only after successful push/pull");
  assert.equal(syncMeta.lastSyncStatus, "synced");
}

runScenario().then(() => {
  console.log("Sprint 12 cross-device convergence policy contract: PASS");
});
