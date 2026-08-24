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

const businessCollections = [
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
  "deletedOrders"
];
const historyCollections = ["auditLog"];

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

for (const name of businessCollections) {
  assert.match(
    stateFactory,
    new RegExp(`${name}\\s*:\\s*\\[\\]`),
    `Missing business state collection in state factory: ${name}`
  );

  assert.match(
    config,
    new RegExp(`\\b${name}\\b`),
    `SYNC_RESOURCES/config missing business resource: ${name}`
  );
}

for (const name of historyCollections) {
  assert.match(
    stateFactory,
    new RegExp(`${name}\\s*:\\s*\\[\\]`),
    `Missing history state collection in state factory: ${name}`
  );
}

assert.match(
  config,
  /SYNC_RESOURCES:Object\.freeze\(\[[^\]]*services[^\]]*payments[^\]]*payrollRecords[^\]]*deliveryRoutes[^\]]*orderGroupItems[^\]]*deliveryRouteItems[^\]]*deletedOrders/s,
  "SYNC_RESOURCES must retain all canonical business resources"
);
assert.doesNotMatch(
  config,
  /SYNC_RESOURCES:Object\.freeze\(\[[^\]]*auditLog/s,
  "auditLog must remain outside canonical business SYNC_RESOURCES"
);
assert.match(
  config,
  /audit_log is an append-only history stream, not canonical business state/,
  "config must document the audit history boundary"
);

assert.match(gateway, /audit_logs/, "Gateway must retain dedicated audit history support");
assert.match(gateway, /name\s*===\s*"audit_logs"[\s\S]*?\.insert\(/, "Audit history must retain its dedicated append-only insert path");

assert.match(
  uiBridge,
  /GVData|GVSync|replaceState/,
  "UI bridge must remain connected to the canonical state/sync boundary"
);

console.log("Phase 1 state bridge contract: PASS");
