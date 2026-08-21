const fs = require("node:fs");
const assert = require("node:assert/strict");

const syncManager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const queueAuthority = fs.readFileSync("js/core/sync-queue-authority.js", "utf8");

assert.match(
  syncManager,
  /ensureQueueAuthority/,
  "sync manager must activate the authoritative queue boundary before syncing"
);
assert.match(
  syncManager,
  /js\/core\/sync-queue-authority\.js/,
  "sync manager must load the authoritative queue boundary"
);
assert.match(
  syncManager,
  /await ensureQueueAuthority\(\)/,
  "queue authority must be ready before GVData.sync()"
);
assert.match(
  queueAuthority,
  /writeBaselineRaw\(null\)/,
  "queue authority must suppress the baseline optimization while queued work exists"
);

console.log("Sprint 20 queue authority activation contract: PASS");
