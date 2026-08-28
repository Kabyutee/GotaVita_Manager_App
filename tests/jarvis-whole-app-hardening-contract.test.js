const fs = require("fs");

function read(path) { return fs.readFileSync(path, "utf8"); }
function exists(path) { return fs.existsSync(path); }
function assert(condition, message) { if (!condition) throw new Error(`JARVIS whole-app hardening: ${message}`); }

const syncManager = read("js/core/sync-manager.js");
const uiBridge = read("js/core/ui-bridge.js");
const syncStatus = read("js/core/sync-status.js");
const worker = read("worker.js");
const wrangler = read("wrangler.jsonc");

assert(exists("js/core/sync-manager.js"), "canonical sync manager missing");
assert(!exists("js/core/conflict-resolution-integration.js"), "legacy conflict engine must remain retired");
assert(syncManager.includes("gotavita_sync_outbox_v2"), "durable mutation outbox missing");
assert(syncManager.includes("gotavita_sync_baseline_v2"), "canonical v2 baseline missing");
assert(syncManager.includes("capturePendingLocalMutations"), "local mutation capture boundary missing");
assert(syncManager.includes("executeMutation"), "mutation execution boundary missing");
assert(syncManager.includes("concurrentMutationDetected"), "in-flight mutation protection missing");
assert(syncManager.includes("startRealtime"), "Realtime invalidation boundary missing");
assert(syncManager.includes("requestRealtimeSync"), "Realtime request boundary missing");
assert(syncManager.includes("window.GVSync = Object.freeze"), "GVSync public authority missing");
assert(syncManager.includes("window.syncNow = () => window.GVSync.flush"), "manual sync alias missing");
assert(!syncManager.includes("Math.random()"), "non-deterministic queue identity remains");
assert(!syncManager.includes("GVConflictIntegration"), "legacy conflict integration remains in canonical manager");

assert(!uiBridge.includes("GVData.selectResource"), "UI bridge still performs cloud reads");
assert(!uiBridge.includes("GVData.upsertResource"), "UI bridge still performs cloud writes");
assert(!syncStatus.includes("setInterval("), "sync status owns a scheduler");
assert(!syncStatus.includes("GVData.selectResource"), "sync status performs cloud reads");

assert(worker.includes('url.pathname === "/gv-health"'), "health endpoint missing");
assert(worker.includes('url.pathname === "/gv-config"'), "config endpoint missing");
assert(worker.includes("LEGACY_API_RETIRED"), "retired API boundary is not explicit");
assert(!worker.includes("sync-cloud-write-reconciler"), "Worker still injects hidden cloud reconciler");
assert(!worker.includes("order-remote-pull-fix"), "Worker still injects hidden Order poller");
assert(!worker.includes("sync-p0-auth-hydration"), "Worker still injects hidden P0 hydrator");
assert(!worker.includes("sync-complete-runtime-repair"), "Worker still injects hidden runtime repair");
assert(!worker.includes("sync-p0-final-canonicalizer"), "Worker still injects hidden final canonicalizer");
assert(!worker.includes("sync-queue-authority"), "Worker still injects hidden queue authority");
assert(!worker.includes("sync-authority"), "Worker still injects hidden sync authority");

assert(wrangler.includes('"observability"'), "Workers observability is not configured");
assert(wrangler.includes('"compatibility_date"'), "Workers compatibility date is missing");

console.log("JARVIS WHOLE-APP HARDENING CONTRACT: PASS");
console.log(JSON.stringify({
  canonicalSyncV2: true,
  durableOutbox: true,
  concurrencyProtection: true,
  realtimeAsInvalidation: true,
  uiPresentationOnly: true,
  workerBoundaries: true,
  workersConfiguration: true,
  result: "PASS"
}, null, 2));