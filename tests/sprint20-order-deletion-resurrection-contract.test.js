const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-cloud-write-reconciler.js", "utf8");

async function runScenario({ baselineRows, remoteOrders, remoteDeleted, localRows }) {
  let upserts = 0;
  const storage = new Map([
    [
      "gotavita_sync_baseline_v1",
      JSON.stringify({ state: { orders: baselineRows } })
    ]
  ]);

  const context = {
    console,
    Date,
    Map,
    Set,
    Promise,
    JSON,
    Number,
    String,
    Error,
    window: {
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key)
      },
      GVData: {
        selectResource: async (resource) =>
          resource === "deleted_orders" ? remoteDeleted : remoteOrders,
        upsertResource: async (_resource, rows) => {
          upserts += rows.length;
          return rows;
        }
      },
      addEventListener: () => {}
    }
  };

  context.window.window = context.window;
  vm.runInNewContext(source, context, { filename: "sync-cloud-write-reconciler.js" });

  const result = await context.window.GVData.upsertResource("orders", localRows);
  return { result, upserts };
}

(async () => {
  const deleted = await runScenario({
    baselineRows: [{ id: "order-1", updatedAt: "2026-08-21T00:00:00.000Z" }],
    remoteOrders: [],
    remoteDeleted: [{ id: "order-1", deleted: true, deletedAt: "2026-08-21T01:00:00.000Z" }],
    localRows: [{ id: "order-1", updatedAt: "2026-08-21T00:30:00.000Z" }]
  });

  assert.equal(deleted.upserts, 0, "Remote tombstone must prevent stale local order resurrection");
  assert.deepEqual(deleted.result, [], "Deleted order must not be written back to remote");

  const baselineMissing = await runScenario({
    baselineRows: [{ id: "order-2", updatedAt: "2026-08-21T00:00:00.000Z" }],
    remoteOrders: [],
    remoteDeleted: [],
    localRows: [{ id: "order-2", updatedAt: "2026-08-21T00:30:00.000Z" }]
  });

  assert.equal(baselineMissing.upserts, 0, "Baseline-known missing order must be deferred to conflict/deletion reconciliation");
  assert.deepEqual(baselineMissing.result, [], "Baseline-known missing order must not be resurrected by write reconciliation");

  const brandNew = await runScenario({
    baselineRows: [],
    remoteOrders: [],
    remoteDeleted: [],
    localRows: [{ id: "order-3", updatedAt: "2026-08-21T00:30:00.000Z" }]
  });

  assert.equal(brandNew.upserts, 1, "Truly new local order must still be eligible for cloud write");

  console.log("Sprint 20 order deletion resurrection contract: PASS");
})();
