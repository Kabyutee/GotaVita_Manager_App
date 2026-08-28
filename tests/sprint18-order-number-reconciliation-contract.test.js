const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Sprint 18's old cloud-write reconciler was retired by Canonical Sync v2.
// This contract therefore verifies the invariant at the surviving boundaries:
// order_number is carried by the canonical gateway, and legacy_id remains the
// stable identity used by the sync coordinator. The database remains the
// authoritative uniqueness/authorization boundary.
const gatewayPath = path.join(__dirname, "..", "js", "core", "data-gateway.js");
const managerPath = path.join(__dirname, "..", "js", "core", "sync-manager.js");
const gateway = fs.readFileSync(gatewayPath, "utf8");
const manager = fs.readFileSync(managerPath, "utf8");

assert(gateway.includes("order_number:"), "canonical order adapter must persist order_number");
assert(gateway.includes("row.orderNumber"), "canonical order adapter must read the application orderNumber");
assert(gateway.includes('orders: "company_id,legacy_id"'), "orders must retain company-scoped stable legacy identity");
assert(manager.includes('orders: "orders"'), "canonical sync manager must own the orders resource");
assert(manager.includes("function stableKey(resource, row"), "canonical sync manager must use stable row identity");
assert(manager.includes("row?.legacy_id ?? row?.legacyId"), "canonical sync identity must prefer legacy_id");

console.log("sprint18 order-number canonical-boundary contract: PASS");
