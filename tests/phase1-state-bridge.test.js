const fs = require("node:fs");
const assert = require("node:assert/strict");

const script = fs.readFileSync("script.js", "utf8");
const stateFactory = fs.readFileSync("js/core/state.js", "utf8");
const config = fs.readFileSync("js/core/config.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
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

assert.equal(
  count(/function replaceState\s*\(/g, script),
  1,
  "replaceState() must have exactly one implementation"
);
assert.equal(
  count(/function getStateSnapshot\s*\(/g, script),
  1,
  "getStateSnapshot() must have exactly one implementation"
);

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
  "SYNC_RESOURCES must include the complete Sprint 10 state surface"
);

assert.match(
  gateway,
  /window\.GVData\s*=/,
  "GVData gateway export was not found"
);
assert.match(
  script,
  /window\.GVData/,
  "script.js must integrate with the GVData cloud boundary"
);

assert.match(
  uiBridge,
  /function installSupabaseHydrationBoundary\(\)/,
  "Supabase hydration boundary is missing"
);
assert.match(
  uiBridge,
  /const facade = Object\.assign\(\{\}, original, \{/,
  "Hydration must preserve the frozen gateway contract with a wrapped facade"
);
assert.match(
  uiBridge,
  /health: async function wrappedHealth\(/,
  "Hydration must wrap the gateway health method"
);
assert.match(
  uiBridge,
  /sync: async function wrappedSync\(/,
  "Cross-device sync must wrap the gateway sync method"
);
assert.match(
  uiBridge,
  /window\.GVData = Object\.freeze\(facade\)/,
  "Wrapped gateway must remain frozen"
);
assert.match(
  uiBridge,
  /await hydrateFromSupabase\(original\)/,
  "Hydration must execute from the existing health boundary"
);
assert.match(
  uiBridge,
  /typeof window\.replaceState !== \"function\"/,
  "Hydration must guard against a missing authoritative replaceState bridge"
);
assert.match(
  uiBridge,
  /if \(!cloudHasData\)/,
  "Empty Supabase must not erase local/seed state"
);
assert.match(
  uiBridge,
  /if \(!stateName \|\| !rows\.length\) continue;/,
  "Empty cloud resources must not erase local state"
);
assert.match(
  uiBridge,
  /return \{ hydrated: false, reason: \"cloud-read-failed\" \}/,
  "Cloud read failures must preserve local state"
);
assert.match(
  uiBridge,
  /function syncCrossDevice\(original\)/,
  "Cross-device synchronization boundary is missing"
);
assert.match(
  uiBridge,
  /window\.replaceState\(nextState\)/,
  "Synchronization must converge through the authoritative state bridge"
);
assert.match(
  uiBridge,
  /window\.setSyncQueue\((?:\[\]|remainingQueued)\)/,
  "Successful synchronization must drain fully-pushed queues while preserving skipped resources"
);

console.log("Sprint 10 State Bridge + Hydration verification: PASS");
console.log(`Authoritative collections verified: ${requiredCollections.length}`);
console.log(`Top-level state assignment sites: ${assignmentLines.map((x) => x.line).join(", ")}`);
