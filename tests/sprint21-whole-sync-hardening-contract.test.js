const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const conflict = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");
const authority = fs.readFileSync("js/core/sync-authority.js", "utf8");
const queueAuthority = fs.readFileSync("js/core/sync-queue-authority.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(manager, /const POLL_MS = 5000/);
assert.match(manager, /if \(inFlight\) return/);
assert.match(manager, /navigator\.onLine === false/);
assert.match(manager, /authorized\(\)/);
assert.match(manager, /captureBulkSelections/);
assert.match(manager, /restoreBulkSelections/);
assert.match(manager, /__GV_SYNC_TRANSACTION_ACTIVE = true/);
assert.match(manager, /const manualReview = result\.status === "manual-review"/);
assert.match(manager, /if \(!manualReview\) clearQueue\(\)/);
assert.match(manager, /lastSyncStatus: manualReview \? "conflict"/);

assert.match(conflict, /manual-review/);
assert.match(conflict, /recordConflicts/);
assert.match(conflict, /await window\.GVData\.upsertResource/);
assert.match(conflict, /await window\.GVData\.selectResource/);
assert.match(conflict, /window\.replaceState\(nextState\)/);
assert.match(conflict, /setBaseline\(nextBaseline\)/);

assert.match(authority, /__GV_SYNC_TRANSACTION_ACTIVE/);
assert.match(authority, /queueSyncResources/);
assert.match(authority, /GVSync\.flush/);
assert.match(queueAuthority, /writeBaselineRaw\(null\)/);
assert.match(queueAuthority, /readQueue\(\)/);

assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(gateway, /async function deleteResourceByLegacyId/);
assert.match(gateway, /async function sync\(\)/);
assert.match(gateway, /supportedResources/);

console.log("Sprint 21 whole-application synchronization hardening contract: PASS");
