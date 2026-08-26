const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");
const context = {
  window: {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { onLine: true },
  location: { protocol: "https:" },
  Date,
  JSON,
  Set,
  Map,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  console
};
vm.createContext(context);
vm.runInContext(source, context);

const integration = context.window.GVConflictIntegration;
assert.equal(typeof integration?.buildResolutionPlan, "function");

const order = {
  id: "local-1",
  legacyId: "local-1",
  orderNumber: "000999",
  createdAt: "2026-08-27T06:00:00.000Z",
  updatedAt: "2026-08-27T06:00:00.000Z"
};

const keepLocal = integration.buildResolutionPlan(
  [order],
  [],
  "2026-08-27T05:59:00.000Z",
  [],
  [],
  [order]
);
assert.equal(keepLocal[0].action, "keep-local");
assert.equal(keepLocal[0].reason, "order-remote-missing-without-tombstone");

const tombstone = {
  id: "local-1",
  legacy_id: "local-1",
  archivedAt: "2026-08-27T06:01:00.000Z"
};
const allowDelete = integration.buildResolutionPlan(
  [order],
  [],
  "2026-08-27T05:59:00.000Z",
  [],
  [tombstone],
  [order]
);
assert.notEqual(allowDelete[0].reason, "order-remote-missing-without-tombstone");

console.log("Sprint 26 remote-gap Order protection contract: PASS");
