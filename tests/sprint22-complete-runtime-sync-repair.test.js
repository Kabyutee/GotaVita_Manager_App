const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /Always read back from Supabase after the write\/reconciliation phase/);
assert.match(manager, /remoteTombstones/);
assert.match(manager, /makeOrderTombstone/);
assert.match(manager, /rebuildDerivedMembership/);
assert.match(manager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(manager, /setInterval\(\(\) => flush\("poll"\)/);
assert.match(manager, /if \(inFlight\) return inFlight/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(worker, /sync-complete-runtime-repair\.js/);
assert.doesNotMatch(worker, /sync-p0-final-canonicalizer\.js/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(gateway, /async function deleteResourceByLegacyId/);

console.log("Sprint 22 complete runtime synchronization contract: PASS");