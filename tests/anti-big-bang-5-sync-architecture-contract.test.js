const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const ui = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");
const app = fs.readFileSync("script.js", "utf8");

assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /const POLL_MS = 5000/);
assert.match(manager, /if \(inFlight\) return inFlight/);
assert.match(manager, /if \(!navigator\.onLine\)/);
assert.match(manager, /GVAuth\?\.isAuthorized/);
assert.match(manager, /const finalRead = await fetchRemoteSet\(\[\.\.\.resources, "deleted_orders"\]\)/);
assert.match(manager, /applyCanonicalSnapshot\(nextState, finalRead\.results\)/);
assert.match(manager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(manager, /setInterval\(\(\) => flush\("poll"\)/);
assert.match(manager, /window\.syncChangedResources\s*=\s*\(reason\) => window\.GVSync\.flush/);
assert.match(manager, /window\.syncNow\s*=\s*\(\) => window\.GVSync\.flush/);

assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(manager, /sync-cloud-write-reconciler/);
assert.doesNotMatch(manager, /order-remote-pull-fix/);
assert.doesNotMatch(manager, /sync-queue-authority/);

assert.doesNotMatch(ui, /hydrateFromSupabase/);
assert.doesNotMatch(ui, /syncCrossDevice/);
assert.doesNotMatch(ui, /GVData\.sync/);
assert.doesNotMatch(ui, /GVData\.selectResource/);
assert.doesNotMatch(ui, /GVData\.upsertResource/);

assert.doesNotMatch(worker, /sync-cloud-write-reconciler/);
assert.doesNotMatch(worker, /order-remote-pull-fix/);
assert.doesNotMatch(worker, /sync-p0-auth-hydration/);
assert.doesNotMatch(worker, /sync-complete-runtime-repair/);
assert.doesNotMatch(worker, /sync-p0-final-canonicalizer/);
assert.doesNotMatch(worker, /sync-queue-authority/);

// Critical UI bootstrap must not depend on auth/network/sync initialization.
const uiDelegationPosition = app.indexOf("installUIEventDelegation();");
const authInitPosition = app.indexOf("await window.GVAuth.init();");
assert(uiDelegationPosition >= 0, "critical UI delegation bootstrap missing");
assert(authInitPosition >= 0, "authentication initialization boundary missing");
assert(uiDelegationPosition < authInitPosition, "critical UI delegation must initialize before async auth initialization");
assert.match(app, /try \{\s*initSyncReliability\(\);\s*\} catch \(error\)/, "sync reliability startup must be failure-isolated");

console.log("ANTI BIG BANG 5.0 sync architecture contract: PASS");
