const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

// Hydration may read from Supabase, but it must not invoke a write path.
const hydrationBlock = bridge.match(
  /async function hydrateFromSupabase\([\s\S]*?\n  }\n\n  function getQueuedResources/,
);
assert.ok(hydrationBlock, "Hydration boundary must remain identifiable");
assert.doesNotMatch(
  hydrationBlock[0],
  /upsertResource\(/,
  "Hydration must not activate cloud writes"
);
assert.doesNotMatch(
  hydrationBlock[0],
  /insertResource\(/,
  "Hydration must not perform cloud inserts"
);

// The explicit sync boundary is the only UI bridge path allowed to push queued data.
const syncBlock = bridge.match(
  /async function syncCrossDevice\([\s\S]*?\n  }\n\n  function installGatewayFacade/,
);
assert.ok(syncBlock, "Cross-device sync boundary must remain identifiable");
assert.match(
  syncBlock[0],
  /await original\.upsertResource\(cloudName, rows\)/,
  "Controlled sync must push through the gateway upsert boundary"
);
assert.match(
  syncBlock[0],
  /window\.setSyncQueue\((?:\[\]|remainingQueued)\)/,
  "Queue must update only after successful push/pull completion while preserving skipped resources"
);

// The gateway exposes sync separately from hydration/read APIs.
assert.match(
  gateway,
  /async function sync\(\)[\s\S]*?status:\s*\"gateway-ready\"/,
  "Gateway sync boundary must remain explicit"
);
assert.match(
  bridge,
  /sync:\s*async function wrappedSync\([\s\S]*?syncCrossDevice\(original/,
  "UI cloud writes must flow through the explicit GVData.sync boundary"
);

console.log("Sprint 12 controlled cloud-write activation contract: PASS");
