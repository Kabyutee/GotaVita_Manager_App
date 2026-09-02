const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "js/modules/orders.js"), "utf8");

const revertMatch = source.match(/function\s+revertOrderToUnpaid\s*\(id\)\s*\{([\s\S]*?)\n\}/);
assert.ok(revertMatch, "revertOrderToUnpaid must remain implemented.");

const body = revertMatch[1];
assert.match(
  body,
  /return\s+updateOrderStatus\(id,\s*["']Unpaid["']\)\s*;/,
  "Revert to Unpaid must use the canonical updateOrderStatus transition."
);
assert.doesNotMatch(
  body,
  /\.status\s*=\s*["']Unpaid["']/,
  "Revert to Unpaid must not mutate status directly and bypass deliveryStatus/audit/update handling."
);

const updateMatch = source.match(/function\s+updateOrderStatus\s*\(id,\s*status\)\s*\{([\s\S]*?)\n\}/);
assert.ok(updateMatch, "updateOrderStatus must remain implemented.");
assert.match(updateMatch[1], /deliveryStatus\s*=\s*status\s*===\s*['\"]Paid['\"]\s*\?\s*['\"]Delivered['\"]\s*:\s*\(status\s*===\s*['\"]Unpaid['\"]\s*\?\s*['\"]Out for Delivery['\"]\s*:\s*status\)/,
  "Canonical order status transition must keep deliveryStatus consistent."
);
assert.match(updateMatch[1], /audit\(/, "Canonical order status transition must audit the change.");
assert.match(updateMatch[1], /persistState\(\)/, "Canonical order status transition must persist the change.");

console.log("Order status consistency contract: PASS");
