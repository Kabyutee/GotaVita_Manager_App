const fs = require("node:fs");
const assert = require("node:assert/strict");

// Canonical sync ownership: manager coordinates; queue bridge records mutations.
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const queueBridge = fs.readFileSync("js/core/persist-resource-queue-bridge.js", "utf8");
const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

assert.match(manager, /window\.__GV_SYNC_TRANSACTION_ACTIVE\s*=\s*true/);
assert.match(queueBridge, /queueChangedResources\(/);
assert.match(queueBridge, /Queue the mutation BEFORE the original persistence function/);
assert.match(manager, /if \(window\.__GV_ORDER_DIRECT_WRITE_ACTIVE === true\)/);
assert.match(integration, /window\.persistState\(\)/);

console.log("Sprint 20 sync transaction no-requeue contract: PASS");
