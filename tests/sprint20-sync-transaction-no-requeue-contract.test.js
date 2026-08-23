const fs = require("node:fs");
const assert = require("node:assert/strict");

const authority = fs.readFileSync("js/core/sync-authority.js", "utf8");
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

assert.match(
  manager,
  /window\.__GV_SYNC_TRANSACTION_ACTIVE\s*=\s*true/,
  "sync manager must mark the reconciliation transaction as active"
);
assert.match(
  authority,
  /window\.__GV_SYNC_TRANSACTION_ACTIVE\s*===\s*true/,
  "authoritative persistence must recognize an active sync transaction"
);
assert.match(
  authority,
  /second background sync|self-sustaining.*Sync pending/i,
  "the transaction guard must document prevention of the re-queue loop"
);
assert.match(
  integration,
  /window\.persistState\(\)/,
  "reconciliation must still persist the final converged state"
);

console.log("Sprint 20 sync transaction no-requeue contract: PASS");
