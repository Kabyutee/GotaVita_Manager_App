const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");

assert.match(manager, /let inFlight = null/);
assert.match(manager, /if \(inFlight\) return inFlight/);
assert.match(manager, /if \(!navigator\.onLine\)/);
assert.match(manager, /window\.GVAuth\?\.isAuthorized/);
assert.match(manager, /committing = true/);
assert.match(manager, /saveBaseline\(nextState, auth\?\.profile\?\.company_id\)/);
assert.match(manager, /capturePendingLocalMutations/);
assert.match(manager, /writeOutbox\(/);
assert.match(manager, /concurrentMutationDetected/);
assert.match(manager, /finalRead/);
assert.doesNotMatch(manager, /window\.persistState\(\)/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(manager, /queueSyncResources/);

console.log("Sprint 20 sync transaction no-requeue v2 contract: PASS");
