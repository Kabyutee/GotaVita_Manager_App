const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync(
  "js/core/conflict-resolution-integration.js",
  "utf8"
);

function policy(local, remote, baselineAt) {
  const baseline = Date.parse(baselineAt);
  const lu = local?.updatedAt ? Date.parse(local.updatedAt) : null;
  const ru = remote?.updatedAt ? Date.parse(remote.updatedAt) : null;
  if (![baseline, lu, ru].every(Number.isFinite)) {
    return { action: "manual-review", reason: "indeterminate", mutation: false };
  }
  const lc = lu > baseline;
  const rc = ru > baseline;
  if (!lc && !rc) return { action: "no-conflict", reason: "unchanged", mutation: false };
  if (lc && !rc) return { action: "keep-local", reason: "local-only-change", mutation: false };
  if (rc && !lc) return { action: "keep-remote", reason: "remote-only-change", mutation: false };
  if (lu > ru) return { action: "keep-local", reason: "local-newer", mutation: false };
  if (ru > lu) return { action: "keep-remote", reason: "remote-newer", mutation: false };
  return { action: "manual-review", reason: "same-timestamp", mutation: false };
}

function makeDevice(shared) {
  const storage = new Map();
  const session = new Map();
  const state = { products: [] };
  const queue = ["products"];
  const counters = { upserts: 0, replaces: 0, persists: 0, queueClears: 0 };

  const context = {
    console,
    Date,
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
      GVConflictDetector: {
        rowKey: (row) => row?.id == null ? null : String(row.id),
        resolveConflictPolicy: policy
      },
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
  return { context, state, storage, queue, counters };
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

  // Initial device baselines.
  await deviceA.context.window.GVConflictIntegration.run(true);
  await deviceB.context.window.GVConflictIntegration.run(true);

  // Device A changes while B remains stale: A must win and write remotely.
  deviceA.state.products = [{ id: "p1", updatedAt: "2026-08-20T02:00:00.000Z", value: "A" }];
  const aResult = await deviceA.context.window.GVConflictIntegration.run(true);
  assert(aResult.status === "reconciled", "Device A change should reconcile");
  assert(shared.remote.products[0].value === "A", "Device A newer change must reach remote");
  assert(deviceA.counters.upserts === 1, "Device A should perform exactly one cloud write");

  // Device B is still on the baseline: remote-only change must be adopted locally.
  const bResult = await deviceB.context.window.GVConflictIntegration.run(true);
  assert(bResult.status === "reconciled", "Device B should reconcile remote-only change");
  assert(deviceB.state.products[0].value === "A", "Device B must adopt the remote winner");
  assert(deviceB.counters.upserts === 0, "Device B must not write for keep-remote");

  // Same-time concurrent edits must remain manual-review with no cloud write or queue clearing.
  const deviceC = makeDevice(shared);
  const deviceD = makeDevice(shared);
  deviceC.state.products = JSON.parse(JSON.stringify(shared.remote.products));
  deviceD.state.products = JSON.parse(JSON.stringify(shared.remote.products));
  await deviceC.context.window.GVConflictIntegration.run(true);
  await deviceD.context.window.GVConflictIntegration.run(true);

  const sameTime = "2026-08-20T03:00:00.000Z";
  deviceC.state.products = [{ id: "p1", updatedAt: sameTime, value: "C" }];
  deviceD.state.products = [{ id: "p1", updatedAt: sameTime, value: "D" }];
  await deviceC.context.window.GVConflictIntegration.run(true);
  const remoteBeforeManual = JSON.stringify(shared.remote.products);
  const dResult = await deviceD.context.window.GVConflictIntegration.run(true);

  assert(dResult.status === "manual-review", "Same-time concurrent edit must require manual review");
  assert(JSON.stringify(shared.remote.products) === remoteBeforeManual, "Manual review must not write to remote");
  assert(deviceD.counters.upserts === 0, "Manual review must perform zero cloud writes");
  assert(deviceD.queue.length === 1, "Manual review must preserve the sync queue");
  assert(deviceD.counters.queueClears === 0, "Manual review must not clear the sync queue");
  assert(deviceD.state.products[0].value === "D", "Manual review must preserve the local candidate");

  console.log("Sprint 12 two-device conflict scenarios: PASS");
})();
