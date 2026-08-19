const fs = require("node:fs");
const assert = require("node:assert/strict");

const script = fs.readFileSync("script.js", "utf8");
const stateFactory = fs.readFileSync("js/core/state.js", "utf8");
const config = fs.readFileSync("js/core/config.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

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

// Phase 1 contract: one authoritative whole-state replacement boundary.
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

// The only whole-state assignments allowed in the main file are the bridge's
// replacement assignment and its invalid-state recovery assignment.
const assignmentLines = script
  .split(/\r?\n/)
  .map((line, index) => ({ line: index + 1, text: line }))
  .filter(({ text }) => /^\s*state\s*=/.test(text));

assert.ok(
  assignmentLines.length <= 2,
  `Unexpected number of top-level state assignments: ${assignmentLines.length}`
);

// Sprint 10 state factory contract.
for (const name of requiredCollections) {
  assert.match(
    stateFactory,
    new RegExp(`${name}\\s*:\\s*\\[\\]`),
    `Missing state collection in state factory: ${name}`
  );
}

// The sync bridge must observe every authoritative state collection. This is
// the Phase 1 hardening fix that prevents newer resources from being skipped
// when persistState() builds its changed-resource queue.
for (const name of requiredCollections) {
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

// The gateway remains the cloud boundary rather than a second application-state authority.
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

console.log("Phase 1 State Bridge verification: PASS");
console.log(`Authoritative collections verified: ${requiredCollections.length}`);
console.log(`Top-level state assignment sites: ${assignmentLines.map((x) => x.line).join(", ")}`);
