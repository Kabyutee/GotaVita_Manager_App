const fs = require("node:fs");
const assert = require("node:assert/strict");

const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");
const boundary = fs.readFileSync("js/core/order-write-boundary-bridge.js", "utf8");

assert(integration.includes("__GV_ORDER_MUTATION_EPOCH"), "conflict integration must observe the Order mutation epoch");
assert(integration.includes("state-changed-during-run"), "stale reconciliation must abort before replacing newer Order state");
assert(integration.includes("mutationEpochAtStart"), "reconciliation must capture mutation epoch at start");
assert(integration.includes("mutationEpochAtStart !== Number(window.__GV_ORDER_MUTATION_EPOCH || 0)"), "reconciliation must detect an Order mutation that started during the run");
assert(boundary.includes("__GV_ORDER_MUTATION_EPOCH"), "Order write boundary must advance the mutation epoch");
assert(boundary.includes("__GV_ORDER_DIRECT_WRITE_ACTIVE = true"), "Order writes must remain marked active during the mutation");

console.log("Sprint 25 Order reconciliation race contract: PASS");
