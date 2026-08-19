const fs = require("node:fs");
const assert = require("node:assert/strict");

const script = fs.readFileSync("script.js", "utf8");
const stateFactory = fs.readFileSync("js/core/state.js", "utf8");
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

// Whole-state replacement must be observable through the bridge functions.
assert.match(
  script,
  /function replaceState[\s\S]*?state\s*=\s*nextState[\s\S]*?normalizeState\(\)/,
  "replaceState() must own the state replacement and normalization path"
);
assert.match(
  script,
  /function getStateSnapshot\s*\([\s\S]*?return clone\(state\)/,
  "getStateSnapshot() must return a cloned authoritative state"
);

// Reject accidental alternate top-level replacement implementations.
const assignmentLines = script
  .split(/\r?\n/)
  .map((line, index) => ({ line: index + 1, text: line }))
  .filter(({ text }) => /^\s*state\s*=/.test(text));

assert.ok(
  assignmentLines.length <= 2,
  `Unexpected number of top-level state assignments: ${assignmentLines.length}`
);

// The state factory must expose every state collection introduced through Sprint 10.
for (const name of requiredCollections) {
  assert.match(
    stateFactory,
    new RegExp(`${name}\\s*:\\s*\\[\\]`),
    `Missing state collection in state factory: ${name}`
  );
}

// NormalizeState must protect every state-factory collection so hydration/replacement
// cannot silently drop a collection by converting it into undefined/non-array data.
const normalizeMatch = script.match(
  /function normalizeState\(\)[\s\S]*?\n}\n\nfunction audit\(/m
);
assert.ok(normalizeMatch, "Could not locate normalizeState() body");
const normalizeBody = normalizeMatch[0];

for (const name of requiredCollections) {
  assert.match(
    normalizeBody,
    new RegExp(`['\"]${name}['\"]`),
    `normalizeState() does not protect collection: ${name}`
  );
}

// The gateway must remain the cloud boundary rather than introducing a second
// application-state authority.
assert.match(
  gateway,
  /window\.GVData\s*=|window\.GVData\s*=/,
  "GVData gateway export was not found"
);
assert.match(
  script,
  /window\.GVData/,
  "script.js must integrate with the GVData cloud boundary"
);

console.log("Phase 1 State Bridge verification: PASS");
console.log(`Protected collections verified: ${requiredCollections.length}`);
console.log(`Top-level state assignment sites: ${assignmentLines.map((x) => x.line).join(", ")}`);
