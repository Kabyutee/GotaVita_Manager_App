const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const app = fs.readFileSync("script.js", "utf8");

const resources = [
  "orders", "payments", "expenses", "payroll_records", "order_groups",
  "delivery_routes", "daily_reports", "deleted_orders", "order_group_items", "delivery_route_items"
];

for (const resource of resources) {
  assert.match(gateway, new RegExp(`case \\\"${resource}\\\"\\s*:`), `Missing Supabase adapter for ${resource}`);
}

assert.match(gateway, /requireAuthenticatedManager\(/);
assert.match(gateway, /company_id/);
assert.match(gateway, /legacy_id/);
assert.match(gateway, /toSupabaseOrder\(/);
assert.match(gateway, /fromSupabaseOrder\(/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(gateway, /async function sync\(/);

assert.match(manager, /gotavita_sync_baseline_v2/);
assert.match(manager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(manager, /Always read back from Supabase after the write\/reconciliation phase/);
assert.doesNotMatch(manager, /cloudSyncAdapterReady/);

// script.js must retain local persistence; canonical synchronization now owns
// remote transport and reconciliation rather than a disabled legacy adapter flag.
assert.match(app, /function persistState\(/);

console.log("Sprint 18 canonical synchronization readiness contract: PASS");