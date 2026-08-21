const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

assert.match(
  bridge,
  /function rebindDynamicOrderForms\(\)/,
  "Sync UI bridge must provide dynamic order-form rebinding"
);
assert.match(
  bridge,
  /\["orderForm", "order-form-submit", "handleOrderSubmit"\]/,
  "New Order submit handler must be restorable after DOM replacement"
);
assert.match(
  bridge,
  /\["orderEditForm", "order-edit-submit", "handleOrderEditSubmit"\]/,
  "Edit Order submit handler must be restorable after DOM replacement"
);
assert.match(
  bridge,
  /rebindDynamicOrderForms\(\);\n    return result;/,
  "Every background full render must restore dynamic order form bindings"
);
assert.match(
  bridge,
  /form\.__gvSubmitBound/,
  "Dynamic form rebinding must prevent duplicate submit listeners"
);

console.log("Sprint 18 order-form render preservation contract: PASS");
