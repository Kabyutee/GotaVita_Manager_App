const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const syncManager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const syncStatus = fs.readFileSync("js/core/sync-status.js", "utf8");
const authBridge = fs.readFileSync("js/core/sync-auth-startup-bridge.js", "utf8");
const dataGateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const productionGuard = fs.readFileSync("js/core/production-guard.js", "utf8");

for (const script of [
  "js/core/data-gateway.js",
  "js/core/sync-manager.js",
  "js/core/sync-status.js",
  "js/core/production-guard.js"
]) {
  assert.ok(html.includes(`src=\"${script}\"`), `${script} must remain in the explicit core load chain`);
}

assert.match(syncManager, /window\.GVSync\s*=\s*Object\.freeze/, "GVSync must remain the single public sync coordinator");
assert.match(syncManager, /window\.GVConflictIntegration/, "GVSync must use the canonical conflict/sync integration");
assert.match(syncManager, /window\.syncChangedResources\s*=\s*\(\)\s*=>\s*window\.GVSync\.flush\(\)/, "legacy syncChangedResources must delegate to GVSync");
assert.match(syncManager, /setInterval\(\(\)\s*=>\s*\{\s*flush\(\)/, "GVSync must own the single background scheduler");
assert.doesNotMatch(syncStatus, /setInterval\(/, "sync-status must not own another background scheduler");
assert.doesNotMatch(syncStatus, /window\.GVSync\.poll\(\)/, "sync-status must not trigger synchronization");
assert.doesNotMatch(authBridge, /setInterval\(/, "auth startup bridge must not own a synchronization timer");
assert.doesNotMatch(syncManager, /window\.GVData\.sync\(/, "GVSync must not treat the gateway health hook as the sync transaction");
assert.doesNotMatch(syncManager, /document\.querySelector\('script\[data-gv-order-number-reconciler/, "GVSync must not dynamically stack cloud-write wrappers");
assert.doesNotMatch(productionGuard, /const\s+originalSync\s*=\s*window\.GVData\.sync/, "production guard must not decorate GVData.sync with a second sync transaction");
assert.match(dataGateway, /async function sync\(/, "gateway must retain its transport-facing sync hook");

const timerOwners = [syncManager, syncStatus, authBridge, productionGuard]
  .reduce((count, source) => count + (source.match(/setInterval\s*\(/g) || []).length, 0);
assert.equal(timerOwners, 1, "exactly one synchronization core timer may exist");

console.log("ANTI BIG BANG 5.0 sync architecture contract: PASS");
