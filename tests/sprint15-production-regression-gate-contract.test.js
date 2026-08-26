const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");

for (const required of [
  "node tests/sprint12-conflict-detection-contract.test.js",
  "node tests/sprint12-conflict-policy-contract.test.js",
  "node tests/sprint12-conflict-resolution-policy-contract.test.js",
  "node tests/sprint12-controlled-conflict-integration-contract.test.js",
  "node tests/sprint12-two-device-conflict-scenarios.test.js",
  "node tests/sprint12-live-sync-polling-contract.test.js",
  "node tests/sprint14-order-edit-group-contract.test.js",
  "node tests/sprint26-order-remote-gap-protection.test.js"
]) {
  assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const syntaxTarget of [
  "node --check js/core/sync-manager.js",
  "node --check js/core/conflict-resolution-integration.js",
  "node --check js/modules/groups-routes.js",
  "node --check worker.js"
]) {
  assert.match(source, new RegExp(syntaxTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(source, /GV_RELEASE_SHA: \$\{\{ github\.sha \}\}/);
assert.match(source, /ref: \$\{\{ github\.sha \}\}/);
assert.match(source, /Production deployment verified:/);
assert.match(source, /pull_request:/g) === null;
console.log("Sprint 15 production regression gate contract: PASS");
