const fs = require("node:fs");
const assert = require("node:assert/strict");

const index = fs.readFileSync("index.html", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const ui = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const status = fs.readFileSync("js/core/sync-status.js", "utf8");

assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(manager, /const canonical = await fetchRemoteSet\(resources\)/);
assert.match(manager, /replaceState\(nextState\)/);
assert.match(manager, /writeBaseline\(nextState, companyId\)/);
assert.match(manager, /remoteTombstones/);
assert.match(manager, /makeOrderTombstone/);
assert.match(manager, /deleted_orders/);
assert.match(manager, /setInterval\(\(\) => flush\("poll"\)/);
assert.match(manager, /window\.syncNow = \(\) => window\.GVSync\.flush\("manual"\)/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(manager, /sync-cloud-write-reconciler/);
assert.doesNotMatch(manager, /order-remote-pull-fix/);
assert.doesNotMatch(manager, /sync-queue-authority/);

assert.doesNotMatch(ui, /hydrateFromSupabase/);
assert.doesNotMatch(ui, /syncCrossDevice/);
assert.doesNotMatch(ui, /selectResource\(/);
assert.doesNotMatch(ui, /upsertResource\(/);
assert.match(ui, /window\.GVUI\s*=\s*Object\.freeze/);

assert.match(status, /window\.GVSync\?\.meta/);
assert.doesNotMatch(status, /loadScript\(/);
assert.doesNotMatch(status, /createElement\(["']script/);
assert.doesNotMatch(status, /setInterval\(/);
assert.doesNotMatch(status, /GVData\.selectResource/);
assert.doesNotMatch(status, /GVData\.upsertResource/);

assert.doesNotMatch(worker, /sync-cloud-write-reconciler/);
assert.doesNotMatch(worker, /order-remote-pull-fix/);
assert.doesNotMatch(worker, /sync-p0-auth-hydration/);
assert.doesNotMatch(worker, /sync-complete-runtime-repair/);
assert.doesNotMatch(worker, /sync-p0-final-canonicalizer/);
assert.doesNotMatch(worker, /group-membership-sync-bridge/);
assert.doesNotMatch(worker, /realtime-channel-lifecycle-fix/);
assert.doesNotMatch(worker, /sync-queue-authority/);

assert.match(index, /js\/core\/sync-manager\.js/);
assert.match(index, /js\/core\/ui-bridge\.js/);
assert.match(index, /js\/core\/sync-status\.js/);

console.log("Canonical sync v2 architecture contract: PASS");