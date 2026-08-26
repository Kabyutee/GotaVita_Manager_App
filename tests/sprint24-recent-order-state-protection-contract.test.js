const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/recent-order-state-protection.js", "utf8");

assert(source.includes("PROTECT_MS = 2 * 60 * 1000"), "recent protection window must exist");
assert(source.includes("window.replaceState = protectedReplaceState"), "replaceState must be protected");
assert(source.includes("nextState?.deletedOrders"), "Order tombstones must be honored");
assert(source.includes("currentTime > incomingTime"), "newer local Order must beat stale incoming state");
assert(source.includes("incomingOrders.push(cloneRow(currentRow))"), "missing recent local Orders must be preserved");

console.log("Sprint 24 recent Order state protection contract: PASS");
