const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

(async () => {
  const root = process.cwd();
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

  const lifecycleSource = read("js/core/application-lifecycle-guard.js");
  const configSource = read("js/core/config.js");
  const runtimeSource = read("js/core/sync-runtime-activation.js");
  const authSource = read("js/core/auth.js");
  const stateSource = read("js/core/state.js");

  assert.match(lifecycleSource, /audit_logs/);
  assert.match(lifecycleSource, /supportedResources\(\)\s*\{[\s\S]*filter/);
  assert.match(lifecycleSource, /health:\s*safeHealth/);
  assert.match(runtimeSource, /__GV_APP_READY\s*!==\s*true/);
  assert.doesNotMatch(configSource, /SYNC_RESOURCES:[\s\S]*auditLog/);
  assert.match(authSource, /requireManagerSession[\s\S]*validateSession\(data\?\.session \|\| null, false\)/);
  assert.match(authSource, /onAuthStateChange[\s\S]*validateSession\(session, false\)/);
  assert.match(stateSource, /window\.addEventListener\("gv-auth-state-changed"/);
  assert.match(stateSource, /__GV_APP_READY/);
  assert.match(stateSource, /gateDomReadyListener/);

  let originalHealthCalled = 0;
  let syncCalled = 0;
  let pollingStopped = 0;
  const windowObj = {
    GVData: Object.freeze({
      supportedResources: () => ["clients", "orders", "audit_logs"],
      health: async () => { originalHealthCalled++; return { ok: true }; },
      sync: async () => ({ ok: true }),
      selectResource: async () => [],
    }),
    GVSync: {
      stopPolling: () => { pollingStopped++; },
      flush: async () => { syncCalled++; return { ok: true }; }
    },
    GVAuth: {
      requireManagerSession: async () => ({ profile: { company_id: "company-1" } })
    },
    location: { protocol: "https:" },
  };
  windowObj.window = windowObj;
  const context = vm.createContext({
    window: windowObj,
    navigator: { onLine: true },
    console,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    performance,
  });

  vm.runInContext(lifecycleSource, context, { filename: "application-lifecycle-guard.js" });
  assert.equal(windowObj.GVApplicationLifecycleGuard.install(), true);
  assert.deepEqual(windowObj.GVData.supportedResources(), ["clients", "orders"]);
  assert.equal(pollingStopped, 1);
  await windowObj.GVData.health();
  assert.equal(originalHealthCalled, 0, "health boundary must not invoke the old mutating gateway health wrapper");
  const bootSync = await windowObj.GVData.sync();
  assert.equal(bootSync.status, "booting");
  assert.equal(syncCalled, 0);

  console.log("Application lifecycle and sync registry contract: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});