const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const app = fs.readFileSync("script.js", "utf8");

const resources = [
  ["clients", "Client"],
  ["products", "Product"],
  ["employees", "Employee"],
  ["orders", "Order"],
  ["payments", "Payment"],
  ["expenses", "Expense"],
  ["payroll_records", "Payroll"],
  ["order_groups", "OrderGroup"],
  ["order_group_items", "OrderGroupItem"],
  ["delivery_routes", "DeliveryRoute"],
  ["delivery_route_items", "DeliveryRouteItem"],
  ["daily_reports", "DailyReport"],
  ["deleted_orders", "DeletedOrder"]
];

for (const [resource, adapter] of resources) {
  assert.match(
    gateway,
    new RegExp(`function toSupabase${adapter}\\(`),
    `Missing local-to-Supabase adapter for ${resource}`
  );

  assert.match(
    gateway,
    new RegExp(`function fromSupabase${adapter}\\(`),
    `Missing Supabase-to-local adapter for ${resource}`
  );

  assert.match(
    gateway,
    new RegExp(`case \\\"${resource}\\\"[\\s\\S]*?toSupabase${adapter}\\(`),
    `Resource ${resource} is not registered in the local-to-Supabase adapter switch`
  );

  assert.match(
    gateway,
    new RegExp(`case \\\"${resource}\\\"[\\s\\S]*?fromSupabase${adapter}\\(`),
    `Resource ${resource} is not registered in the Supabase-to-local adapter switch`
  );
}

assert.match(
  gateway,
  /function toSupabaseAuditLog\(/,
  "Audit-log local-to-Supabase adapter is missing"
);
assert.match(
  gateway,
  /case \"audit_logs\"[\s\S]*?toSupabaseAuditLog\(/,
  "Audit-log adapter is not registered"
);
assert.match(
  gateway,
  /case \"audit_logs\"[\s\S]*?mergePayload\(/,
  "Audit-log Supabase-to-local mapping is missing"
);

assert.match(
  gateway,
  /legacy_payload:\s*json\(row\)/,
  "Local payload preservation must remain available for migrated resources"
);
assert.match(
  gateway,
  /function toSupabaseResource\(/,
  "Resource-level adapter entry point is missing"
);
assert.match(
  gateway,
  /function fromSupabaseResource\(/,
  "Resource-level reverse adapter entry point is missing"
);

// This checkpoint audits the adapter only. Cloud write activation stays disabled
// until the adapter contract is proven by CI and the next write-safety checkpoint.
assert.match(
  app,
  /function cloudSyncAdapterReady\(\)[\s\S]*?return false;/,
  "Cloud write activation must remain disabled during adapter verification"
);

console.log("Sprint 12 schema adapter contract: PASS");
console.log(`Bidirectional resource adapters verified: ${resources.length}`);
