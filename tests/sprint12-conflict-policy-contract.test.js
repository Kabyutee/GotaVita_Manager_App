const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(
  bridge,
  /for \(const resource of queued\)/,
  "Conflict policy must process queued local resources first"
);
assert.match(
  bridge,
  /await original\.upsertResource\(cloudName, rows\)/,
  "Queued local resources must be pushed before cloud hydration"
);
assert.match(
  bridge,
  /const entries = await Promise\.all\(\s*supported\.map\(async \(resource\)/,
  "Synchronization must perform a cloud read-back after queued pushes"
);
assert.match(
  bridge,
  /nextState\[stateName\] = normalizeResourceRows\(resource, rows\)/,
  "Cloud read-back must become the reconciled local state"
);
assert.match(
  bridge,
  /if \(typeof window\.setSyncQueue === \"function\"\) \{\s*window\.setSyncQueue\((?:\[\]|remainingQueued)\)/,
  "Sync queue must update only after the push/read-back sequence succeeds"
);
assert.doesNotMatch(
  gateway,
  /onConflict:\s*\"updated_at\"/,
  "The current checkpoint must not silently introduce timestamp-only conflict resolution"
);

console.log("Sprint 12 conflict policy contract: PASS");
