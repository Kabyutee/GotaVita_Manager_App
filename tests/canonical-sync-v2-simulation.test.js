const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function makeBrowser(remote, options = {}) {
  const storage = new Map();
  let state = { orders: [], clients: [], products: [], services: [], employees: [], payments: [], expenses: [], payrollRecords: [], orderGroups: [], deliveryRoutes: [], orderGroupItems: [], deliveryRouteItems: [], dailyReports: [], deletedOrders: [], _meta: {} };
  const selectCalls = [];
  let failUpsertResource = options.failUpsertResource || null;
  const window = {};
  const context = {
    window,
    document: { activeElement: null, addEventListener() {} },
    navigator: { onLine: true },
    console,
    setTimeout,
    clearTimeout,
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
    crypto: { randomUUID: () => "test-uuid" },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) }
  };
  window.localStorage = context.localStorage;
  window.addEventListener = () => {};
  window.getStateSnapshot = () => clone(state);
  window.replaceState = (next) => { state = clone(next); };
  window.writeLocalStateSnapshot = () => true;
  window.GVAuth = { isAuthorized: () => true };
  window.GVUI = { renderAll() {} };
  window.GVData = {
    supportedResources: () => ["orders", "deleted_orders"],
    requireAuthenticatedManager: async () => ({ authenticated: true, profile: { company_id: "company-1" } }),
    selectResource: async (resource) => {
      selectCalls.push(resource);
      return clone(remote[resource] || []);
    },
    upsertResource: async (resource, rows) => {
      if (resource === failUpsertResource) throw new Error(`simulated ${resource} write failure`);
      const next = remote[resource] ? remote[resource].slice() : [];
      for (const row of rows) {
        const key = String(row.legacy_id ?? row.legacyId ?? row.id);
        const index = next.findIndex((item) => String(item.legacy_id ?? item.legacyId ?? item.id) === key);
        if (index >= 0) next[index] = clone(row); else next.push(clone(row));
      }
      remote[resource] = next;
      return clone(rows);
    },
    deleteResourceByLegacyId: async (resource, legacyId) => {
      remote[resource] = (remote[resource] || []).filter((row) => String(row.legacy_id ?? row.legacyId ?? row.id) !== String(legacyId));
      return [];
    }
  };
  vm.runInNewContext(source, context, { filename: "sync-manager.js" });
  return {
    flush: (...args) => window.GVSync.flush(...args),
    getState: () => clone(state),
    setState: (next) => { state = clone(next); },
    setFailUpsertResource: (resource) => { failUpsertResource = resource; },
    selectCalls,
    storage
  };
}

(async () => {
  const remote = { orders: [{ id: 1, legacy_id: "1", orderNumber: "0000001", status: "Paid", address: "BASE", updatedAt: "2026-08-28T00:00:00.000Z" }], deleted_orders: [] };
  const browserA = makeBrowser(remote);
  const browserB = makeBrowser(remote);

  await browserA.flush("startup");
  await browserB.flush("startup");
  assert.equal(browserA.getState().orders.length, 1);
  assert.equal(browserB.getState().orders.length, 1);

  const created = { id: 2, legacy_id: "2", orderNumber: "0000002", status: "Unpaid", address: "SYNC-A", updatedAt: "2026-08-28T00:01:00.000Z" };
  browserA.setState({ ...browserA.getState(), orders: [...browserA.getState().orders, created] });
  await browserA.flush("local-mutation");
  assert.equal(remote.orders.length, 2, "Browser A create must reach remote canonical state");

  await browserB.flush("poll");
  assert.equal(browserB.getState().orders.some((row) => row.legacy_id === "2"), true, "Browser B must converge on Browser A create");

  const edited = { ...created, address: "SYNC-A-EDITED", updatedAt: "2026-08-28T00:02:00.000Z" };
  browserA.setState({ ...browserA.getState(), orders: browserA.getState().orders.map((row) => row.legacy_id === "2" ? edited : row) });
  await browserA.flush("local-mutation");
  await browserB.flush("poll");
  assert.equal(browserB.getState().orders.find((row) => row.legacy_id === "2")?.address, "SYNC-A-EDITED");

  browserA.setState({ ...browserA.getState(), orders: browserA.getState().orders.filter((row) => row.legacy_id !== "2") });
  await browserA.flush("local-mutation");
  assert.equal(remote.orders.some((row) => row.legacy_id === "2"), false, "Browser A delete must remove remote Order");
  assert.equal(remote.deleted_orders.some((row) => row.legacy_id === "2"), true, "Order delete must create durable tombstone");

  await browserB.flush("poll");
  assert.equal(browserB.getState().orders.some((row) => row.legacy_id === "2"), false, "Browser B must converge on Order deletion");

  // Adversarial case: the local edit is older than a remote edit, but its sync
  // detection is intentionally delayed. The row timestamp, not detection time,
  // must determine the winner.
  const remoteEdited = { id: 1, legacy_id: "1", orderNumber: "0000001", status: "Paid", address: "REMOTE-NEWER", updatedAt: "2026-08-28T00:04:00.000Z" };
  remote.orders = [remoteEdited];
  browserA.setState({ ...browserA.getState(), orders: browserA.getState().orders.map((row) => row.legacy_id === "1" ? { ...row, address: "LOCAL-OLDER", updatedAt: "2026-08-28T00:03:00.000Z" } : row) });
  await browserA.flush("delayed-local-edit");
  assert.equal(remote.orders.find((row) => row.legacy_id === "1")?.address, "REMOTE-NEWER", "newer remote edit must beat delayed stale local edit");
  assert.equal(browserA.getState().orders.find((row) => row.legacy_id === "1")?.address, "REMOTE-NEWER", "local state must converge to newer remote edit");

  // Safety case: a remote deletion tombstone must beat a stale local upsert.
  const tombstoned = { id: 3, legacy_id: "3", orderNumber: "0000003", status: "Paid", address: "STALE-LOCAL", updatedAt: "2026-08-28T00:05:00.000Z" };
  const tombstoneRemote = {
    orders: [],
    deleted_orders: [{ id: "3", legacy_id: "3", deleted: true, deletedAt: "2026-08-28T00:06:00.000Z", updatedAt: "2026-08-28T00:06:00.000Z", legacy_payload: clone(tombstoned) }]
  };
  const browserTombstone = makeBrowser(tombstoneRemote);
  browserTombstone.setState({ ...browserTombstone.getState(), orders: [tombstoned] });
  await browserTombstone.flush("startup");
  assert.equal(tombstoneRemote.orders.some((row) => row.legacy_id === "3"), false, "a newer remote tombstone must never be resurrected by stale local bootstrap state");
  assert.equal(browserTombstone.getState().orders.some((row) => row.legacy_id === "3"), false, "local state must honor a newer remote tombstone");

  // Failure safety: a failed remote write must retain the durable outbox entry,
  // report a partial result, and succeed on the next retry.
  const failureRemote = { orders: [{ id: 10, legacy_id: "10", orderNumber: "0000010", status: "Paid", address: "BASE", updatedAt: "2026-08-28T00:00:00.000Z" }], deleted_orders: [] };
  const browserFailure = makeBrowser(failureRemote, { failUpsertResource: "orders" });
  await browserFailure.flush("startup");
  const failedOrder = { id: 11, legacy_id: "11", orderNumber: "0000011", status: "Unpaid", address: "QUEUED", updatedAt: "2026-08-28T00:07:00.000Z" };
  browserFailure.setState({ ...browserFailure.getState(), orders: [...browserFailure.getState().orders, failedOrder] });
  const failedResult = await browserFailure.flush("local-mutation");
  assert.equal(failedResult.ok, false, "failed remote write must not report success");
  assert.equal(failedResult.status, "partial", "failed remote write must report partial synchronization");
  assert.ok(JSON.parse(browserFailure.storage.get("gotavita_sync_outbox_v2") || "[]").some((entry) => entry.key === "legacy:11"), "failed mutation must remain in durable outbox");
  browserFailure.setFailUpsertResource(null);
  const retryResult = await browserFailure.flush("retry");
  assert.equal(retryResult.ok, true, "queued mutation must succeed after transport recovery");
  assert.equal(failureRemote.orders.some((row) => row.legacy_id === "11"), true, "retried mutation must reach remote state");

  // Efficiency evidence: one startup sync of the two-resource simulation should
  // read each resource once per phase, never duplicate deleted_orders.
  const efficiencyRemote = { orders: [{ id: 20, legacy_id: "20", updatedAt: "2026-08-28T00:00:00.000Z" }], deleted_orders: [] };
  const browserEfficiency = makeBrowser(efficiencyRemote);
  await browserEfficiency.flush("startup");
  const callCounts = browserEfficiency.selectCalls.reduce((counts, resource) => ({ ...counts, [resource]: (counts[resource] || 0) + 1 }), {});
  assert.equal(callCounts.orders, 2, "startup sync should read orders once per phase");
  assert.equal(callCounts.deleted_orders, 2, "startup sync should read deleted_orders once per phase");
  assert.equal(browserEfficiency.selectCalls.length, 4, `startup sync should perform exactly 4 remote reads, got ${browserEfficiency.selectCalls.length}`);

  console.log("Canonical sync v2 convergence, adversarial safety, failure durability, and efficiency simulation: PASS");
})();