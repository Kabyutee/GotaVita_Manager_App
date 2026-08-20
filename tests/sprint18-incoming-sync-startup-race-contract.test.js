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
  assert.equal(result.remoteChanged, false, "A converged local push must not request an unnecessary background render");
  assert.equal(result.renderRequired, false, "A converged sync must not force an unnecessary render");

  state.orders = [
    { id: "new-local-order", total: 30 },
    { id: "second-local-order", total: 90 }
  ];
  queue = [];
  cloud.orders = [{ id: "remote-order", total: 60 }];
  replaced = null;
  upserts = [];

  const readsBeforeDirtyHealth = hydrateReads;
  await context.window.GVData.health();
  assert.equal(hydrateReads, readsBeforeDirtyHealth, "Background health must not hydrate while a local resource is dirty");
  assert.equal(replaced, null, "Background health must not replace dirty local state");

  const dirtyResult = await context.window.GVData.sync(true);
  assert.equal(dirtyResult.ok, true, "Dirty local state must synchronize successfully even when the queue is empty");
  assert.ok(upserts.some(([resource]) => resource === "orders"), "Locally changed orders must be pushed before the background pull");
  assert.ok(upserts.some(([, rows]) => rows.some((row) => row.id === "second-local-order")), "The newly created local order must not be discarded by a background pull");
  assert.ok(replaced.orders.some((row) => row.id === "second-local-order"), "New local order must survive the pull/convergence cycle");
  assert.equal(dirtyResult.remoteChanged, false, "A local dirty-resource push that converges to cloud state must not request an unnecessary render");

  queue = [];
  state.orders = [{ id: "existing-local-order", total: 30 }];
  cloud.orders = [
    { id: "existing-local-order", total: 30 },
    { id: "incoming-remote-order", total: 75 }
  ];
  replaced = null;
  const incomingResult = await context.window.GVData.sync(true);

  assert.equal(incomingResult.ok, true, "Incoming remote synchronization must succeed");
  assert.equal(incomingResult.remoteChanged, true, "Incoming cloud changes must be reported as remote changes");
  assert.equal(incomingResult.stateChanged, true, "Incoming cloud changes must report stateChanged");
  assert.equal(incomingResult.renderRequired, true, "Incoming cloud changes must request a UI render");
  assert.ok(
    Array.isArray(incomingResult.remoteChangedResources) && incomingResult.remoteChangedResources.includes("orders"),
    "Incoming order changes must identify the orders resource"
  );
  assert.ok(replaced.orders.some((row) => row.id === "incoming-remote-order"), "Incoming remote order must converge into local state");

  queue = [];
  localStorageData.clear();
  state.orders = [{ id: "existing-local-order", total: 30 }];
  cloud.orders = [{ id: "remote-order", total: 60 }];
  replaced = null;
  const readsBeforeIncomingHydrate = hydrateReads;

  await context.window.GVData.health();
  assert.ok(hydrateReads > readsBeforeIncomingHydrate, "An idle device must still hydrate incoming cloud changes when no local baseline exists");
  assert.ok(replaced, "Incoming hydration must replace the stale local snapshot");
  assert.equal(replaced.orders[0].id, "remote-order", "Incoming remote order must survive refresh");

  console.log("Sprint 18 incoming sync startup race contract: PASS");
})();
