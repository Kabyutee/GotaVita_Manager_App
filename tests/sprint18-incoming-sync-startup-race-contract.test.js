const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");
let queue = ["orders"];
let hydrateReads = 0;
let upserts = [];
let replaced = null;
const localStorageData = new Map();

const state = {
  orders: [{ id: "new-local-order", total: 30 }],
  clients: [], products: [], services: [], employees: [], payments: [], expenses: [],
  payrollRecords: [], orderGroups: [], deliveryRoutes: [], orderGroupItems: [],
  deliveryRouteItems: [], dailyReports: [], deletedOrders: [], auditLog: [], _meta: {}
};

const cloud = {
  clients: [], products: [], services: [], employees: [],
  orders: [{ id: "remote-order", total: 30 }], payments: [], expenses: [],
  payroll_records: [], order_groups: [], delivery_routes: [], order_group_items: [],
  delivery_route_items: [], daily_reports: [], deleted_orders: [], audit_logs: []
};

const supported = Object.keys(cloud);
const original = {
  health: async () => ({ ok: true, mode: "supabase" }),
  supportedResources: () => supported,
  selectResource: async (resource) => {
    hydrateReads += 1;
    return cloud[resource];
  },
  upsertResource: async (resource, rows) => {
    upserts.push([resource, rows]);
    cloud[resource] = rows;
    return rows;
  }
};

const context = {
  console, Date, Map, Object, Array, Number, String, Promise, JSON, Error,
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
  const health = await context.window.GVData.health();
  assert.equal(health.ok, true);
  assert.equal(hydrateReads, 0, "Startup health must not hydrate while local writes are queued");

  const result = await context.window.GVData.sync(true);
  assert.equal(result.ok, true);
  assert.ok(upserts.some(([resource]) => resource === "orders"), "Queued local order must be pushed before remote pull");
  assert.ok(replaced, "Sync must converge state after the push/pull cycle");
  assert.equal(queue.length, 0, "Successfully pushed queue must drain");

  // Regression: a local mutation must survive a background poll even if the
  // normal resource queue was accidentally empty. The last successful sync
  // baseline identifies the unsynced local resource before the remote pull.
  state.orders = [
    { id: "new-local-order", total: 30 },
    { id: "second-local-order", total: 90 }
  ];
  queue = [];
  cloud.orders = [{ id: "remote-order", total: 60 }];
  replaced = null;
  upserts = [];

  const dirtyResult = await context.window.GVData.sync(true);
  assert.equal(dirtyResult.ok, true, "Dirty local state must synchronize successfully even when the queue is empty");
  assert.ok(upserts.some(([resource]) => resource === "orders"), "Locally changed orders must be pushed before the background pull");
  assert.ok(upserts.some(([, rows]) => rows.some((row) => row.id === "second-local-order")), "The newly created local order must not be discarded by a background pull");
  assert.ok(replaced.orders.some((row) => row.id === "second-local-order"), "New local order must survive the pull/convergence cycle");

  // Model the other device: no local queue, then a remote order exists.
  queue = [];
  state.orders = [{ id: "existing-local-order", total: 30 }];
  cloud.orders = [{ id: "remote-order", total: 60 }];
  replaced = null;
  const readsBeforeIncomingPull = hydrateReads;

  await context.window.GVData.health();
  assert.ok(hydrateReads > readsBeforeIncomingPull, "An idle device must still hydrate incoming cloud changes");
  assert.ok(replaced, "Incoming hydration must replace the stale local snapshot");
  assert.equal(replaced.orders[0].id, "remote-order", "Incoming remote order must survive refresh");

  console.log("Sprint 18 incoming sync startup race contract: PASS");
})();
