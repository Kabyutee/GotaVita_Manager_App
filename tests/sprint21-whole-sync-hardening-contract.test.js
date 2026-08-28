const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const ui = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");

assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /const POLL_MS = 5000/);
assert.match(manager, /if \(inFlight\) return inFlight/);
assert.match(manager, /if \(!navigator\.onLine\)/);
assert.match(manager, /GVAuth\?\.isAuthorized/);
assert.match(manager, /Always read back from Supabase after the write\/reconciliation phase/);
assert.match(manager, /remoteTombstones/);
assert.match(manager, /makeOrderTombstone/);
assert.match(manager, /writeBaseline\(nextState, companyId\)/);
assert.match(manager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(manager, /window\.syncChangedResources\s*=\s*\(\) => window\.GVSync\.flush/);
assert.match(manager, /window\.syncNow\s*=\s*\(\) => window\.GVSync\.flush/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(manager, /sync-cloud-write-reconciler/);
assert.doesNotMatch(manager, /order-remote-pull-fix/);

assert.doesNotMatch(ui, /selectResource\(/);
assert.doesNotMatch(ui, /upsertResource\(/);
assert.doesNotMatch(ui, /GVData\.sync/);
assert.match(ui, /window\.GVUI\s*=\s*Object\.freeze/);

assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(gateway, /async function deleteResourceByLegacyId/);
assert.match(gateway, /async function sync\(/);

assert.doesNotMatch(worker, /sync-cloud-write-reconciler/);
assert.doesNotMatch(worker, /order-remote-pull-fix/);
assert.doesNotMatch(worker, /sync-p0-auth-hydration/);
assert.doesNotMatch(worker, /sync-complete-runtime-repair/);
assert.doesNotMatch(worker, /sync-p0-final-canonicalizer/);

console.log("Sprint 21 whole-application synchronization hardening contract: PASS");