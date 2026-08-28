const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(manager, /function chooseWinner\(localRow, remoteRow\)/);
assert.match(manager, /if \(lt > rt\) return "local"/);
assert.match(manager, /if \(rt > lt\) return "remote"/);
assert.match(manager, /const localChanged/);
assert.match(manager, /const remoteChanged/);
assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /remoteTombstones/);
assert.match(manager, /makeOrderTombstone/);
assert.match(manager, /writeBaseline\(nextState, companyId\)/);
assert.doesNotMatch(manager, /gotavita_conflict_baseline_v1/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);

console.log("Sprint 12 conflict resolution policy contract: PASS");