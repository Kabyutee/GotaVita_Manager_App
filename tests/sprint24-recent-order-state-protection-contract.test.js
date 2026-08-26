const fs = require("node:fs");
const assert = require("node:assert/strict");

const protection = fs.readFileSync("js/core/recent-order-state-protection.js", "utf8");
const syncRepair = fs.readFileSync("js/core/sync-complete-runtime-repair.js", "utf8");

assert(protection.includes("PROTECT_MS = 2 * 60 * 1000"), "recent protection window must exist");
assert(protection.includes("window.GVRecentOrderStateProtection"), "protection helper must be exported explicitly");
assert(protection.includes("nextState.deletedOrders"), "Order tombstones must be honored");
assert(protection.includes("currentTime > incomingTime"), "newer local Order must beat stale incoming state");
assert(protection.includes("incomingOrders.push(cloneRow(currentRow))"), "missing recent local Orders must be preserved");
assert(syncRepair.includes("GVRecentOrderStateProtection?.protectState"), "authoritative sync boundary must apply protection before replaceState");
assert(!protection.includes("window.replaceState = protectedReplaceState"), "protection must not replace the central state owner");

console.log("Sprint 24 recent Order state protection contract: PASS");
