const fs = require("fs");
const path = require("path");
const assert = require("assert");

const file = path.join(__dirname, "..", "js", "core", "state.js");
const text = fs.readFileSync(file, "utf8");

assert(text.includes('id === "orderForm"'), "state runtime guard must target the New Order form");
assert(text.includes('capture: true'), "order-number allocator guard must run in capture phase");
assert(text.includes("orderCounter"), "state runtime guard must reconcile orderCounter");
assert(text.includes("deletedOrders"), "allocator must consider archived/deleted orders");
assert(text.includes("getStateSnapshot"), "allocator must use the current application state");
assert(text.includes("replaceState"), "allocator must persist the reconciled counter into application state");

console.log("sprint18 order-number allocator runtime contract: PASS");
