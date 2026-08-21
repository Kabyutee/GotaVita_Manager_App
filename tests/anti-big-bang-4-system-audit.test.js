const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
function assert(condition, message) {
  if (!condition) throw new Error(`ANTI BIG BANG 5.0 AUDIT: ${message}`);
}

const syncManager = read("js/core/sync-manager.js");
const uiBridge = read("js/core/ui-bridge.js");
const syncStatus = read("js/core/sync-status.js");
const gateway = read("js/core/data-gateway.js");
const worker = read("worker.js");
const prodWorkflow = read(".github/workflows/deploy-production.yml");
const riskGate = read(".github/workflows/anti-big-bang-risk-gate.yml");
const architectureContract = read("tests/anti-big-bang-5-sync-architecture-contract.test.js");

// One runtime synchronization authority.
assert(/window\.GVSync\s*=\s*Object\.freeze/.test(syncManager), "GVSync authority missing from sync manager");
assert(/window\.syncChangedResources\s*=\s*\(\)\s*=>\s*window\.GVSync\.flush\(\)/.test(syncManager), "legacy sync entry point must delegate to GVSync");
assert(/window\.syncNow\s*=\s*\(\)\s*=>\s*window\.GVSync\.flush\(\)/.test(syncManager), "manual sync entry point must delegate to GVSync");
assert(!/setInterval\(/.test(syncStatus), "sync-status must remain presentation-only");
assert(!/window\.GVData\.sync\(/.test(syncManager), "sync manager must not use the gateway health hook as the transaction authority");
assert(!/originalSync/.test(syncStatus), "legacy post-sync wrapper still exists");
assert(!/originalSync\s*=\s*window\.GVData\.sync/.test(read("js/core/production-guard.js")), "production guard still wraps GVData.sync");

// The UI bridge must use the explicit sync result contract for rendering.
assert(/remoteChanged/.test(uiBridge), "remoteChanged render contract missing");
assert(/stateChanged/.test(uiBridge), "stateChanged render contract missing");
assert(/renderRequired/.test(uiBridge), "renderRequired render contract missing");
assert(/failedResources/.test(uiBridge), "failed resource diagnostics missing");
assert(/failedErrors/.test(uiBridge), "failed error diagnostics missing");
assert(/remainingQueued/.test(uiBridge), "failed-resource queue preservation missing");

// Gateway remains the transport/schema/auth boundary.
assert(/requireAuthenticatedManager/.test(gateway), "manager authorization guard missing");
assert(/company_id/.test(gateway), "company scope handling missing");
assert(/upsert\(/.test(gateway), "cloud upsert path missing");
assert(/onConflict/.test(gateway), "cloud conflict key missing");
assert(/async function sync\(/.test(gateway), "gateway transport hook missing");

// Production deployment must self-report and verify exact release SHA.
assert(/GV_RELEASE_SHA/.test(worker), "Worker release SHA endpoint missing");
assert(/EXPECTED_SHA/.test(prodWorkflow), "production workflow lacks exact SHA verification");
assert(/Production deployment: NOT performed/.test(riskGate), "risk gate must not deploy production");
assert(/single public sync coordinator/.test(architectureContract), "architecture contract missing canonical coordinator language");

console.log("ANTI BIG BANG 5.0 system audit passed.");
