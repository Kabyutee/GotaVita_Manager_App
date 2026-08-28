const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(manager, /function localMutationWins\(entry, remoteRow\)/);
assert.match(manager, /function mutationTime\(entry\)/);
assert.match(manager, /function executeMutation\(entry, remoteRows, baseline(?:, remoteDeletedRows = \[\])?\)/);
assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /function orderTombstone\(row, timestamp\)/);
assert.match(manager, /deleted_orders/);
assert.match(manager, /function applyCanonicalSnapshot\(nextState, canonical\)/);
assert.match(manager, /function saveBaseline\(state, companyId\)/);
assert.match(manager, /finalRead/);
assert.match(manager, /concurrentMutationDetected/);
assert.doesNotMatch(manager, /gotavita_conflict_baseline_v1/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);

console.log("Sprint 12 conflict resolution v2 contract: PASS");
