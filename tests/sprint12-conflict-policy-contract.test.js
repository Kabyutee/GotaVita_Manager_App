const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(
  bridge,
  /const resourcesToPush = \[\.\.\.new Set\(\[\.\.\.queued, \.\.\.locallyChanged\]\)\]/,
  "Conflict policy must prioritize queued local resources before inferred dirty resources"
);
assert.match(
  bridge,
  /for \(const resource of resourcesToPush\)/,
  "Conflict policy must process the complete local-write set before cloud pull"
);
assert.match(
  bridge,
  /await original\.upsertResource\(cloudResourceName\(resource\), rows\)/,
  "Local resources must be pushed before cloud hydration"
);
assert.match(
  bridge,
  /const entries = await Promise\.all\(\s*supported\.map\(async \(resource\)/,
  "Synchronization must perform a cloud read-back after local pushes"
);
assert.match(
  bridge,
  /nextState\[stateName\] = normalizeResourceRows\(resource, rows\)/,
  "Cloud read-back must become the reconciled local state"
);
assert.match(
  bridge,
  /if \(typeof window\.setSyncQueue === \"function\"\) window\.setSyncQueue\(remainingQueued\)/,
  "Sync queue must update only after the push/read-back sequence succeeds"
);
assert.match(
  bridge,
  /function getLocallyChangedResources\(snapshot, supported\)/,
  "Background sync must detect locally dirty resources even when the queue is empty"
);
assert.match(
  bridge,
  /stableRows\(snapshot\?\.\[stateName\]\) !== stableRows\(baseline\.state\[stateName\]\)/,
  "Dirty-resource detection must compare current state against the last successful sync baseline"
);
assert.doesNotMatch(
  gateway,
  /onConflict:\s*\"updated_at\"/,
  "The current checkpoint must not silently introduce timestamp-only conflict resolution"
);

console.log("Sprint 12 conflict policy contract: PASS");
