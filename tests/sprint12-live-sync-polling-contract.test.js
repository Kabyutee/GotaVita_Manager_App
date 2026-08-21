const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");

let syncCalls = 0;
let renderCalls = 0;
let scheduled = null;
let queue = [];
let localStorageData = {};

const context = {
  console,
  Date,
  JSON,
  Math,
  Promise,
  navigator: { onLine: true },
  localStorage: {
    getItem: (key) => localStorageData[key] ?? null,
    setItem: (key, value) => { localStorageData[key] = String(value); },
    removeItem: (key) => { delete localStorageData[key]; }
  },
  setInterval: (handler, ms) => {
    scheduled = { handler, ms };
    return 1;
  },
  setTimeout,
  document: undefined,
  window: {
    GVAuth: { isAuthorized: () => true },
    GVConflictIntegration: {
      getBaseline: () => ({ baseline: { baselineAt: new Date().toISOString(), rows: [] } }),
      run: async () => {
        syncCalls++;
        return { ok: true, status: "synced", results: [] };
      }
    },
    GVData: {
      supportedResources: () => [],
      selectResource: async () => []
    },
    GVUI: {
      renderAll: () => { renderCalls++; }
    },
    getSyncQueue: () => [...queue],
    setSyncQueue: (next) => { queue = [...next]; },
    addEventListener: () => {}
  }
};

context.window.window = context.window;
vm.runInNewContext(source, context, { filename: "sync-manager.js" });

(async () => {
  // Authorized startup performs one immediate canonical pull even with an empty queue.
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(syncCalls, 1, "Authorized startup must perform an initial remote pull");

  const result = await context.window.GVSync.flush();

  assert.equal(result.ok, true);
  assert.equal(result.status, "synced");
  assert.equal(syncCalls, 2, "Empty queue must still perform a remote pull/sync");
  assert.equal(queue.length, 0, "Polling layer must not mutate an empty queue");
  assert.equal(renderCalls, 0, "Gateway/auth success without remote state change must not rebuild the UI");

  assert.ok(scheduled, "Authorized startup must install polling");
  assert.equal(scheduled.ms, 5000, "Polling interval must remain bounded at 5 seconds");

  await scheduled.handler();
  assert.equal(syncCalls, 3, "Polling must invoke the shared canonical sync coordinator");
  assert.equal(renderCalls, 0, "Polling health checks must not rebuild Order Log without remote state change");

  console.log("Sprint 12/17 live sync + UI preservation contract: PASS");
})();
