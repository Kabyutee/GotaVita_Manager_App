const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(`ANTI BIG BANG 4.0 AUDIT: ${message}`);
}

const syncManager = read("js/core/sync-manager.js");
const syncAuthority = read("js/core/sync-authority.js");
const uiBridge = read("js/core/ui-bridge.js");
const syncStatus = read("js/core/sync-status.js");
const script = read("script.js");
const gateway = read("js/core/data-gateway.js");
const worker = read("worker.js");
const prodWorkflow = read(".github/workflows/deploy-production.yml");

// One runtime synchronization authority.
assert(/GVData\.sync/.test(syncManager), "GVData.sync authority missing from sync manager");
assert(!/gateway\.sync\s*=\s*async function/.test(syncStatus), "legacy sync-status monkey patch still exists");
assert(!/const\s+originalSync\s*=\s*gateway\.sync\.bind/.test(syncStatus), "legacy post-sync wrapper still exists");
assert(/window\.persistState\s*=\s*persistStateAuthoritatively/.test(syncAuthority), "authoritative persistence boundary missing");
assert(/window\.syncChangedResources\s*=\s*flushAuthoritatively/.test(syncAuthority), "authoritative sync entry point missing");
assert(/window\.startSyncReliability\s*=/.test(syncAuthority), "legacy reliability timer is not quarantined");

// Legacy script.js sync code is permitted only as a quarantined compatibility layer.
assert(/sync-authority\.js/.test(worker), "Worker does not load the authoritative sync boundary");
assert(/script\.js[\\\"']?\s*[,)]/.test(syncAuthority) || /persistStateAuthoritatively/.test(syncAuthority), "authoritative compatibility boundary is not explicit");

// The UI bridge must use the explicit sync result contract for rendering.
assert(/remoteChanged/.test(uiBridge), "remoteChanged render contract missing");
assert(/stateChanged/.test(uiBridge), "stateChanged render contract missing");
assert(/renderRequired/.test(uiBridge), "renderRequired render contract missing");

// Cloud failures must remain visible instead of being converted into a false success.
assert(/failedResources/.test(uiBridge), "failed resource diagnostics missing");
assert(/failedErrors/.test(uiBridge), "failed error diagnostics missing");
assert(/remainingQueued/.test(uiBridge), "failed-resource queue preservation missing");

// Gateway must enforce manager/company scope.
assert(/requireAuthenticatedManager/.test(gateway), "manager authorization guard missing");
assert(/company_id/.test(gateway), "company scope handling missing");
assert(/upsert\(/.test(gateway), "cloud upsert path missing");
assert(/onConflict/.test(gateway), "cloud conflict key missing");

// Production deployment must self-report and verify its exact release SHA.
assert(/GV_RELEASE_SHA/.test(worker), "Worker release SHA endpoint missing");
assert(/EXPECTED_SHA/.test(prodWorkflow), "production workflow lacks exact SHA verification");

// Prevent accidental production mutation from the risk gate itself.
const riskGate = read(".github/workflows/anti-big-bang-risk-gate.yml");
assert(/Production deployment: NOT performed/.test(riskGate), "risk gate must not deploy production");

console.log("ANTI BIG BANG 4.0 system audit passed.");
