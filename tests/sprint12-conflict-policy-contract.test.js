const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /function localMutationWins\(entry, remoteRow\)/);
assert.match(manager, /function mutationTime\(entry\)/);
assert.match(manager, /function executeMutation\(entry, remoteRows, baseline\)/);
assert.match(manager, /Always read back|finalRead|canonicalResult/);
assert.match(manager, /function applyCanonicalSnapshot\(nextState, canonical\)/);
assert.match(manager, /function saveBaseline\(state, companyId\)/);
assert.match(manager, /window\.GVData\.upsertResource\(entry\.resource, \[clone\(entry\.row\)\]\)/);
assert.match(manager, /concurrentMutationDetected/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(manager, /gotavita_conflict_baseline_v1/);

assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.doesNotMatch(gateway, /onConflict:\s*"updated_at"/);

console.log("Sprint 12 conflict policy v2 contract: PASS");
