const fs = require("node:fs");
const assert = require("node:assert/strict");

const state = fs.readFileSync("js/core/state.js", "utf8");
const orderBridge = fs.readFileSync("js/core/order-write-boundary-bridge.js", "utf8");

assert.match(state, /function reconcileOrderCounterBeforeCreate\(\)/);
assert.match(state, /state\.orderCounter|snapshot\.orderCounter/);
assert.match(state, /deletedOrders/);
assert.match(state, /numericOrderNumber/);
assert.match(state, /orderForm/);
assert.match(orderBridge, /handleOrderSubmit/);
assert.match(orderBridge, /upsertResource\("orders"/);

console.log("sprint18 order-number reconciliation contract: PASS");
