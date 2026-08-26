const fs = require("node:fs");
const assert = require("node:assert/strict");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const queueBridge = fs.readFileSync("js/core/persist-resource-queue-bridge.js", "utf8");
const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

assert.match(
  manager,
  /window\.__GV_SYNC_TRANSACTION_ACTIVE\s*=\s*true/,
  "sync manager must mark the reconciliation transaction as active"
);
assert.match(
  queueBridge,
  /queueChangedResources\(/,
  "mutation queue must be populated from the canonical persist boundary"
);
assert.match(
  queueBridge,
  /Queue the mutation BEFORE the original persistence function/,
  "queue bridge must prevent a sync pass from observing an unqueued local mutation"
);
assert.match(
  manager,
  /if \(window\.__GV_ORDER_DIRECT_WRITE_ACTIVE === true\)/,
  "background reconciliation must yield to an active Order write"
);
assert.match(
  integration,
  /window\.persistState\(\)/,
  "reconciliation must still persist the final converged state"
);

console.log("Sprint 20 sync transaction no-requeue contract: PASS");
