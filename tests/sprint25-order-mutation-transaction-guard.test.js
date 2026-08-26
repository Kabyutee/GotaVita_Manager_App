const fs = require("node:fs");
const assert = require("node:assert/strict");

const guard = fs.readFileSync("js/core/order-mutation-transaction-guard.js", "utf8");
const runtime = fs.readFileSync("js/core/sync-runtime-activation.js", "utf8");

assert(guard.includes("__GV_ORDER_MUTATION_EPOCH"), "Order mutations must advance an epoch");
assert(guard.includes("__GV_LATEST_ORDER_MUTATION_SNAPSHOT"), "completed Order mutations must retain the authoritative local snapshot");
assert(guard.includes("__GV_LATEST_ORDER_MUTATION_SNAPSHOT_EPOCH"), "mutation snapshots must be tied to an epoch");
assert(guard.includes("__GV_ORDER_WRITE_BOUNDARY_BRIDGE__"), "guard must install after the durable Order write boundary");
assert(guard.includes("handleOrderSubmit"), "create Order must be guarded");
assert(guard.includes("handleOrderEditSubmit"), "edit Order must be guarded");
assert(guard.includes("archiveOrders"), "archive/delete Order must be guarded");
assert(guard.includes("orderMutationRestored"), "a stale sync must restore the completed Order mutation snapshot");
assert(guard.includes("sync.flush"), "the guard must protect the asynchronous sync transaction");
assert(runtime.includes("/js/core/order-mutation-transaction-guard.js"), "runtime activation must load the transaction guard");

console.log("Sprint 25 Order mutation transaction guard contract: PASS");
