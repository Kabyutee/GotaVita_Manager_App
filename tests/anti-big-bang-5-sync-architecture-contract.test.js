const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const syncManager = fs.readFileSync("js/core/sync-manager.js", "utf8");
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
assert.doesNotMatch(syncManager, /window\.GVData\s*=\s*Object\.freeze/, "sync manager must not replace the data gateway object");
assert.doesNotMatch(productionGuard, /const\s+originalSync\s*=\s*window\.GVData\.sync/, "production guard must not decorate GVData.sync with a second sync transaction");
assert.match(dataGateway, /async function sync\(/, "gateway must expose its transport-facing sync hook");

console.log("ANTI BIG BANG 5.0 sync architecture contract: PASS");
