const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-queue-authority.js", "utf8");

assert.match(
  source,
  /captureBulkSelectionState/,
  "Sync render boundary must capture bulk selection state"
);
assert.match(
  source,
  /restoreBulkSelectionState/,
  "Sync render boundary must restore bulk selection state"
);
assert.match(
  source,
  /\.order-checkbox/,
  "Active-order selections must be preserved"
);
assert.match(
  source,
  /\.billing-checkbox/,
  "Billing selections must be preserved"
);
assert.match(
  source,
  /\.all-order-checkbox/,
  "All-order selections must be preserved"
);
assert.match(
  source,
  /originalRenderAll\.apply/,
  "The canonical render function must remain authoritative"
);

console.log("Sprint 20 bulk selection preservation contract: PASS");