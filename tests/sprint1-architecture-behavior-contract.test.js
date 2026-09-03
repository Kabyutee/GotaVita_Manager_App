const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contract = JSON.parse(
  fs.readFileSync(path.join(root, "contracts/sprint1-architecture-behavior-contract.json"), "utf8")
);
const configSource = fs.readFileSync(path.join(root, "js/core/config.js"), "utf8");
const stateSource = fs.readFileSync(path.join(root, "js/core/state.js"), "utf8");
const gatewaySource = fs.readFileSync(path.join(root, "js/core/data-gateway.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

const requiredResources = contract.protectedSyncResources;
const expectedPersistenceStages = [
  "UI/feature module",
  "in-memory GV_STATE",
  "local persistence / dirty queue",
  "GVSync",
  "GVData",
  "Supabase",
  "remote reconciliation",
  "state replacement",
  "UI render"
];

assert.equal(contract.baseline, "4eb4a0d1e7a81f0fc6836dd839fd80972508f3fa");
assert.equal(contract.authModel, "manager-only");
assert.equal(contract.canonicalState, "GV_STATE");
assert.equal(contract.canonicalSyncCoordinator, "GVSync");
assert.equal(contract.canonicalTransport, "GVData");
assert.deepEqual(contract.persistencePath, expectedPersistenceStages);

for (const stage of ["GVSync", "GVData", "Supabase"]) {
  assert.ok(contract.persistencePath.includes(stage), `Missing persistence stage: ${stage}`);
}
assert.ok(contract.failureRules.remoteReadFailure.includes("preserve local state"));
assert.ok(contract.failureRules.remoteWriteFailure.includes("pending queue"));
assert.ok(contract.failureRules.partialHydration.includes("partial"));
assert.ok(contract.historicalInvariants.some((rule) => rule.includes("historical order prices")));
assert.ok(contract.historicalInvariants.some((rule) => rule.includes("closed periods")));

for (const resource of requiredResources) {
  assert.match(
    configSource,
    new RegExp(`(?:[\\\"'])${resource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[\\\"'])`),
    `Sync registry is missing ${resource}`
  );
}

assert.match(stateSource, /window\.GV_STATE\s*=\s*Object\.freeze/);
assert.match(stateSource, /replaceState\(snapshot\)/);
assert.match(stateSource, /GVSync\?\.flush/);
assert.match(stateSource, /GVSync\?\.startPolling/);
assert.match(gatewaySource, /function requireAuthenticatedManager/);
assert.match(gatewaySource, /window\.GVAuth/);
assert.match(gatewaySource, /SUPPORTED_RESOURCES/);
assert.ok(!gatewaySource.includes("service_role"), "Public data gateway must not contain service_role credentials");
assert.match(indexSource, /gvAuthState=\"locked\"/);
assert.match(indexSource, /js\/core\/auth\.js/);
assert.match(indexSource, /js\/core\/data-gateway\.js/);
assert.match(indexSource, /js\/core\/sync-manager\.js/);

console.log("Sprint 1 architecture behavior contract: PASS");
