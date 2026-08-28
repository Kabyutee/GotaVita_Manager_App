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
assert(/window\.syncChangedResources\s*=\s*\(reason\)\s*=>\s*window\.GVSync\.flush/.test(syncManager), "legacy sync entry point must delegate to GVSync");
assert(/window\.syncNow\s*=\s*\(\)\s*=>\s*window\.GVSync\.flush/.test(syncManager), "manual sync entry point must delegate to GVSync");
assert(!/setInterval\(/.test(syncStatus), "sync-status must remain presentation-only");
assert(!/window\.GVData\.sync\(/.test(syncManager), "sync manager must not use the gateway sync hook as transaction authority");
assert(!/originalSync/.test(syncStatus), "legacy post-sync wrapper still exists");
assert(!/originalSync\s*=\s*window\.GVData\.sync/.test(read("js/core/production-guard.js")), "production guard still wraps GVData.sync");
assert(/gotavita_sync_outbox_v2/.test(syncManager), "durable mutation outbox missing");
assert(/gotavita_sync_baseline_v2/.test(syncManager), "canonical v2 baseline missing");
assert(/applyCanonicalSnapshot/.test(syncManager), "canonical remote-to-state commit missing");
assert(/concurrentMutationDetected/.test(syncManager), "concurrent local mutation protection missing");

// The UI bridge is presentation-only and may bind forms/rendering, but must not own cloud synchronization.
assert(/window\.GVUI\s*=\s*Object\.freeze/.test(uiBridge), "UI presentation bridge missing");
assert(/renderAll\(\)/.test(uiBridge), "UI render boundary missing");
assert(/guardedSubmitHandler/.test(uiBridge), "dynamic Order form binding boundary missing");
assert(!/GVData\.selectResource/.test(uiBridge), "UI bridge still performs cloud reads");
assert(!/GVData\.upsertResource/.test(uiBridge), "UI bridge still performs cloud writes");

// Sync status must never own the sync scheduler or the cloud transport.
assert(!/setInterval\(/.test(syncStatus), "sync-status still owns a scheduler");
assert(!/GVData\.selectResource/.test(syncStatus), "sync-status performs cloud reads");
assert(!/GVData\.upsertResource/.test(syncStatus), "sync-status performs cloud writes");

// Gateway remains the transport/schema/auth boundary.
assert(/requireAuthenticatedManager/.test(gateway), "manager authorization guard missing");
assert(/company_id/.test(gateway), "company scope handling missing");
assert(/upsert\(/.test(gateway), "cloud upsert path missing");
assert(/onConflict/.test(gateway), "cloud conflict key missing");
assert(/async function sync\(/.test(gateway), "gateway transport hook missing");

// Production deployment must self-report and verify exact release SHA, while the risk gate never deploys production.
assert(/GV_RELEASE_SHA/.test(worker), "Worker release SHA endpoint missing");
assert(/EXPECTED_SHA/.test(prodWorkflow), "production workflow lacks exact SHA verification");
assert(/Production deployment: NOT performed/.test(riskGate), "risk gate must not deploy production");
assert(/GVSync/.test(architectureContract) && /Object\.freeze/.test(architectureContract), "architecture contract must explicitly enforce canonical GVSync authority");

console.log("ANTI BIG BANG 5.0 system audit passed.");
