const fs = require("node:fs");
const assert = require("node:assert/strict");

const worker = fs.readFileSync("worker.js", "utf8");
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const bridge = fs.readFileSync("js/core/order-write-boundary-bridge.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

for (const retired of [
  "sync-complete-runtime-repair.js",
  "sync-cloud-snapshot-safety.js",
  "sync-cloud-write-reconciler.js",
  "sync-queue-authority.js",
  "sync-authority.js",
  "sync-p0-auth-hydration.js",
  "sync-p0-final-canonicalizer.js"
]) {
  assert.doesNotMatch(worker, new RegExp(retired.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(manager, /hydrateFirstBaseline\(integration\)/);
assert.match(manager, /window\.GVSync = Object\.freeze/);
assert.match(manager, /ensureConflictIntegration\(\)/);
assert.match(bridge, /channel\.on\(/);
assert.match(bridge, /channel\.subscribe\(/);
assert.match(bridge, /removeChannel/);
assert.match(bridge, /realtimeStartingChannel/);
assert.match(bridge, /scheduleRealtimeRetry\(channel, client\)/);
assert.match(bridge, /void removeRealtimeChannel\(channel, client\)/);
assert.match(bridge, /upsertResource\("orders"/);
assert.equal((bridge.match(/client\.channel\("gotavita-canonical-sync"\)/g) || []).length, 1);
assert.doesNotMatch(
  bridge,
  /if \(realtimeChannel === channel\) realtimeChannel = null;\s*realtimeStarting = false;\s*setTimeout\(\(\) => startRealtime\(\)/
);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(gateway, /supportedResources/);

console.log("Sprint 22 canonical runtime synchronization contract: PASS");
