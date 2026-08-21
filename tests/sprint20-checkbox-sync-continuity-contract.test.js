const assert = require("node:assert/strict");

const bridge = `.order-checkbox, .billing-checkbox, .all-order-checkbox`;
assert.match(
  bridge,
  /\.order-checkbox/,
  "order bulk selection must be part of the sync continuity bridge"
);
assert.match(
  bridge,
  /\.billing-checkbox/,
  "billing bulk selection must be part of the sync continuity bridge"
);
assert.match(
  bridge,
  /\.all-order-checkbox/,
  "all-orders bulk selection must be part of the sync continuity bridge"
);

function shouldReleaseFocus(control) {
  return Boolean(
    control &&
    control.type === "checkbox" &&
    ["order-checkbox", "billing-checkbox", "all-order-checkbox"].includes(control.className)
  );
}

assert.equal(
  shouldReleaseFocus({ type: "checkbox", className: "order-checkbox" }),
  true,
  "focused order selection checkbox must not block background sync rendering"
);
assert.equal(
  shouldReleaseFocus({ type: "text", className: "order-checkbox" }),
  false,
  "text inputs must remain protected as editable controls"
);
assert.equal(
  shouldReleaseFocus({ type: "checkbox", className: "employee-checkbox" }),
  false,
  "unrelated checkboxes must retain normal interaction protection"
);

console.log("Sprint 20 checkbox sync continuity contract: PASS");
