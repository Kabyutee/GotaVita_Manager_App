const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

function makeDevice(shared) {
  const storage = new Map();
  const session = new Map();
  const state = { products: [] };
  const queue = [];
  const counters = { upserts: 0, replaces: 0, persists: 0, queueClears: 0 };

  const context = {
    console,
    navigator: { onLine: true },
    location: { protocol: "https:" },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value)
    },
    sessionStorage: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key)
    },
    window: {
      location: { protocol: "https:" },
      addEventListener() {},
      getStateSnapshot: () => state,
      replaceState: (next) => {
        counters.replaces++;
        state.products = next.products.slice();
      },
      persistState: () => { counters.persists++; },
      getSyncQueue: () => queue.slice(),
      setSyncQueue: (next) => {
        queue.splice(0, queue.length, ...next);
        counters.queueClears++;
      },
      setSyncStatus() {},
      GVConflictDetector: { rowKey: (row) => row?.id == null ? null : String(row.id) },
      GVData: {
        isConfigured: () => true,
        supportedResources: () => ["products"],
        requireAuthenticatedManager: async () => ({ authenticated: true }),
        selectResource: async (resource) => JSON.parse(JSON.stringify(shared.remote[resource] || [])),
        upsertResource: async (resource, rows) => {
          counters.upserts += rows.length;
          shared.remote[resource] = shared.remote[resource] || [];
          for (const row of rows) {
            const index = shared.remote[resource].findIndex((item) => String(item.id) === String(row.id));
            if (index >= 0) shared.remote[resource][index] = JSON.parse(JSON.stringify(row));
            else shared.remote[resource].push(JSON.parse(JSON.stringify(row)));
          }
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, state, queue, counters };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const shared = {
    remote: {
      products: [{ id: "p1", updatedAt: "2026-08-20T01:00:00.000Z", value: "baseline" }]
    }
  };

  const deviceA = makeDevice(shared);
  const deviceB = makeDevice(shared);
  deviceA.state.products = JSON.parse(JSON.stringify(shared.remote.products));
  deviceB.state.products = JSON.parse(JSON.stringify(shared.remote.products));

  await deviceA.context.window.GVConflictIntegration.run(true);
  await deviceB.context.window.GVConflictIntegration.run(true);

  // Device A: business edit creates a queued local mutation.
  deviceA.state.products = [{ id: "p1", updatedAt: "2026-08-20T02:00:00.000Z", value: "A" }];
  deviceA.queue.push("products");
  const aResult = await deviceA.context.window.GVConflictIntegration.run(true);

  assert(aResult.status === "reconciled", "Device A change should reconcile");
  assert(shared.remote.products[0].value === "A", "Device A queued change must reach remote");
  assert(deviceA.counters.upserts === 1, "Device A should perform exactly one cloud write");
  assert(deviceA.queue.length === 0, "Device A queue should drain after successful canonical re-read");

  // Device B: no local write pending, so the remote row is canonical.
  const bResult = await deviceB.context.window.GVConflictIntegration.run(true);
  assert(bResult.status === "reconciled", "Device B should reconcile remote-only change");
  assert(deviceB.state.products[0].value === "A", "Device B must adopt the remote canonical value");
  assert(deviceB.counters.upserts === 0, "Device B must not write for keep-remote");

  // Equal timestamps no longer dead-end: the first queued writer becomes canonical,
  // and the other device adopts the resulting remote row.
  const deviceC = makeDevice(shared);
  const deviceD = makeDevice(shared);
  deviceC.state.products = JSON.parse(JSON.stringify(shared.remote.products));
  deviceD.state.products = JSON.parse(JSON.stringify(shared.remote.products));

  deviceC.state.products = [{ id: "p1", updatedAt: "2026-08-20T03:00:00.000Z", value: "C" }];
  deviceC.queue.push("products");
  const cResult = await deviceC.context.window.GVConflictIntegration.run(true);
  assert(cResult.status === "reconciled", "First equal-time writer should reconcile normally");
  assert(shared.remote.products[0].value === "C", "First queued equal-time writer must become canonical");
  assert(deviceC.queue.length === 0, "First writer queue must drain after acknowledgement");

  deviceD.state.products = [{ id: "p1", updatedAt: "2026-08-20T03:00:00.000Z", value: "D" }];
  const dResult = await deviceD.context.window.GVConflictIntegration.run(true);
  assert(dResult.status === "reconciled", "Second device must reconcile without manual review");
  assert(deviceD.state.products[0].value === "C", "Second device must adopt the remote canonical value");
  assert(deviceD.counters.upserts === 0, "Second device must not overwrite canonical remote state without a pending local write");

  console.log("Sprint 12 two-device conflict scenarios: PASS");
})();