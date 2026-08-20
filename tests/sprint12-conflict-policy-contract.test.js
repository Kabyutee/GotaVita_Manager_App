const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(
  bridge,
  /const resourcesToPush = baseline\?\.state\s*\n\s*\? locallyChanged\s*\n\s*: \[\.\.\.new Set\(\[\.\.\.queued, \.\.\.locallyChanged\]\)\]/,
  "Conflict policy must ignore stale queue entries when a successful local baseline exists"
);
assert.match(
  bridge,
  /for \(const resource of resourcesToPush\)/,
  "Conflict policy must process the complete actual local-write set before cloud pull"
);
assert.match(
  bridge,
  /await original\.upsertResource\(cloudResourceName\(resource\), rows\)/,
  "Actual local resources must be pushed before cloud reconciliation"
);
assert.match(
  bridge,
  /const entries = await Promise\.all\(\s*supported\.map\(async \(resource\)/,
  "Synchronization must perform a cloud read-back after local pushes"
);
assert.match(
  bridge,
  /nextState\[stateName\] = normalizedRows/,
  "Cloud read-back must become the reconciled local state"
);
assert.match(
  bridge,
  /window\.setSyncQueue\(\[\.\.\.remainingQueued\]\)/,
  "Queue reconciliation must preserve only resources still requiring retry"
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
assert.match(
  bridge,
  /sync: async function wrappedSync\(\.\.\.args\) \{ return syncCrossDevice\(original, \.\.\.args\); \}/,
  "UI bridge must expose the authoritative GVData.sync synchronization boundary"
);
assert.match(
  gateway,
  /upsertResource|selectResource|supportedResources/,
  "Supabase gateway must remain the underlying data boundary used by synchronization"
);
assert.doesNotMatch(
  gateway,
  /onConflict:\s*\"updated_at\"/,
  "The current checkpoint must not silently introduce timestamp-only conflict resolution"
);

console.log("Sprint 12 conflict policy contract: PASS");
