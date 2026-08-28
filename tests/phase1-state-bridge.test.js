const fs = require("node:fs");
const assert = require("node:assert/strict");

const script = fs.readFileSync("script.js", "utf8");
const stateFactory = fs.readFileSync("js/core/state.js", "utf8");
const config = fs.readFileSync("js/core/config.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const syncManager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const uiBridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

function count(pattern, source) {
  return (source.match(pattern) || []).length;
}

const requiredCollections = [
  "products",
  "clients",
  "services",
  "orders",
  "payments",
  "expenses",
  "payrollRecords",
  "employees",
  "orderGroups",
  "deliveryRoutes",
  "orderGroupItems",
  "deliveryRouteItems",
  "dailyReports",
  "deletedOrders",
  "auditLog"
];

assert.equal(count(/function replaceState\s*\(/g, script), 1, "replaceState() must have exactly one implementation");
assert.equal(count(/function getStateSnapshot\s*\(/g, script), 1, "getStateSnapshot() must have exactly one implementation");

assert.match(
  script,
  /function replaceState[\s\S]*?state\s*=\s*nextState[\s\S]*?normalizeState\(\)/,
  "replaceState() must own state replacement and normalization"
);
assert.match(
  script,
  /function getStateSnapshot\s*\([\s\S]*?return clone\(state\)/,
  "getStateSnapshot() must return a cloned authoritative state"
);

const assignmentLines = script
  .split(/\r?\n/)
  .map((line, index) => ({ line: index + 1, text: line }))
  .filter(({ text }) => /^\s*state\s*=/.test(text));

assert.ok(
  assignmentLines.length <= 2,
  `Unexpected number of top-level state assignments: ${assignmentLines.length}`
);

for (const name of requiredCollections) {
  assert.match(
    stateFactory,
    new RegExp(`${name}\\s*:\\s*\\[\\]`),
    `Missing state collection in state factory: ${name}`
  );
  assert.match(
    config,
    new RegExp(`\\b${name}\\b`),
    `SYNC_RESOURCES/config missing state resource: ${name}`
  );
}

assert.match(
  config,
  /SYNC_RESOURCES:Object\.freeze\(\[[^\]]*services[^\]]*payments[^\]]*payrollRecords[^\]]*deliveryRoutes[^\]]*orderGroupItems[^\]]*deliveryRouteItems[^\]]*auditLog/s,
  "SYNC_RESOURCES must include the complete state surface"
);

assert.match(gateway, /window\.GVData\s*=/, "GVData gateway export was not found");
assert.match(script, /window\.GVData/, "script.js must integrate with the GVData cloud boundary");

assert.match(syncManager, /const BASELINE_KEY = "gotavita_sync_baseline_v2"/, "Canonical v2 baseline is missing");
assert.match(syncManager, /const OUTBOX_KEY = "gotavita_sync_outbox_v2"/, "Durable v2 outbox is missing");
assert.match(syncManager, /function captureLocalMutations\(/, "Local mutation capture boundary is missing");
assert.match(syncManager, /function fetchRemoteSet\(/, "Canonical remote hydration boundary is missing");
assert.match(syncManager, /await window\.GVData\.selectResource\(resource\)/, "Remote hydration must use GVData");
assert.match(syncManager, /function applyCanonicalSnapshot\(/, "Canonical state commit boundary is missing");
assert.match(syncManager, /function executeMutation\(/, "Canonical mutation execution boundary is missing");
assert.match(syncManager, /remoteTombstone/, "Order tombstone protection is missing");
assert.match(syncManager, /uniqueResources = \[\.\.\.new Set\(resources\)\]/, "Remote resource reads must be deduplicated");

assert.match(
  uiBridge,
  /presentation boundary only/,
  "UI bridge must remain presentation-only"
);
assert.doesNotMatch(
  uiBridge,
  /function installSupabaseHydrationBoundary\(\)/,
  "Retired Supabase hydration engine must not remain in UI bridge"
);
assert.doesNotMatch(
  uiBridge,
  /function syncCrossDevice\(original\)/,
  "Retired UI-level cloud sync engine must not remain in UI bridge"
);

console.log("Phase 1 state boundary / canonical sync v2 contract: PASS");
