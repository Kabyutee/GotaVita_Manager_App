const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /function orderTombstone\(row, timestamp\)/);
assert.match(manager, /function rebuildDerivedMembership\(state\)/);
assert.match(manager, /function applyCanonicalSnapshot\(nextState, canonical\)/);
assert.match(manager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(manager, /const POLL_MS = 5000/);
assert.match(manager, /if \(inFlight\) return inFlight/);
assert.match(manager, /if \(!navigator\.onLine\)/);
assert.match(manager, /GVAuth\?\.isAuthorized/);
assert.match(manager, /const finalRead = await fetchRemoteSet/);
assert.match(manager, /concurrentMutationDetected/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(worker, /sync-complete-runtime-repair\.js/);
assert.doesNotMatch(worker, /sync-p0-final-canonicalizer\.js/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(gateway, /async function deleteResourceByLegacyId/);

console.log("Sprint 22 complete runtime synchronization v2 contract: PASS");
