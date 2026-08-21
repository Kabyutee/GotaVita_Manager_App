const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();
const BASE_SHA = process.env.BASE_SHA || "";
const HEAD_SHA = process.env.HEAD_SHA || "HEAD";

function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function exists(file) { return fs.existsSync(path.join(ROOT, file)); }
function fail(message) { throw new Error(`JARVIS 8 RUNTIME ADAPTATION AUDIT: ${message}`); }
function assert(condition, message) { if (!condition) fail(message); }

function changedFiles() {
  if (!BASE_SHA) return [];
  return cp.execFileSync("git", ["diff", "--name-only", BASE_SHA, HEAD_SHA], { encoding: "utf8" })
    .split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function registryResources() {
  const source = read("js/core/config.js");
  const match = source.match(/SYNC_RESOURCES:Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert(match, "SYNC_RESOURCES registry missing");
  return [...match[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

const profiles = {
  orders: { files: ["js/modules/orders.js"], state: "orders", runtimeManaged: true },
  clients: { files: ["js/modules/clients.js"], state: "clients", runtimeManaged: true },
  products: { files: ["js/modules/products.js"], state: "products", runtimeManaged: true },
  expenses: { files: ["js/modules/expenses.js"], state: "expenses", runtimeManaged: true },
  employees: { files: ["js/modules/employees-payroll.js"], state: "employees", runtimeManaged: true },
  payrollRecords: { files: ["js/modules/employees-payroll.js"], state: "payrollRecords", runtimeManaged: true },
  orderGroups: { files: ["js/modules/groups-routes.js", "js/core/group-membership-sync-bridge.js"], state: "orderGroups", runtimeManaged: true },
  orderGroupItems: { files: ["js/modules/groups-routes.js", "js/core/group-membership-sync-bridge.js"], state: "orderGroupItems", runtimeManaged: true },
  deliveryRoutes: { files: ["js/modules/groups-routes.js"], state: "deliveryRoutes", runtimeManaged: true },
  deliveryRouteItems: { files: ["js/modules/groups-routes.js"], state: "deliveryRouteItems", runtimeManaged: true },
  dailyReports: { files: ["js/modules/reports.js"], state: "dailyReports", runtimeManaged: true },
  deletedOrders: { files: ["js/modules/orders.js"], state: "deletedOrders", runtimeManaged: true },
  auditLog: { files: ["script.js"], state: "auditLog", runtimeManaged: false },
  payments: { files: ["js/modules/orders.js"], state: "payments", runtimeManaged: true },
  services: { files: ["js/modules/products.js"], state: "services", runtimeManaged: false }
};

const changed = changedFiles();
const registry = registryResources();
const sync = read("js/core/sync-manager.js");
const groupBridge = exists("js/core/group-membership-sync-bridge.js") ? read("js/core/group-membership-sync-bridge.js") : "";

for (const required of ["js/core/config.js", "js/core/data-gateway.js", "js/core/sync-manager.js", "js/core/conflict-resolution-integration.js", "script.js"]) {
  assert(exists(required), `runtime foundation missing: ${required}`);
}

assert(/function\s+reconcile|reconcile\s*=/.test(groupBridge), "group membership reconciliation hook missing");
assert(groupBridge.includes("orderGroupItems") && groupBridge.includes("orderGroups"), "group membership bridge does not model both sides of the relationship");
assert(/hydrateFirstBaseline\(/.test(sync) && /integration\.run\(/.test(sync), "canonical sync transaction/hydration path missing");
assert(/renderRemoteState\(/.test(sync), "remote state render boundary missing");
assert(/queueSyncResources|queue\(\)/.test(sync), "queue authority missing from canonical sync coordinator");

const mappingByState = {
  orderGroups: "order_groups",
  orderGroupItems: "order_group_items",
  deliveryRoutes: "delivery_routes",
  deliveryRouteItems: "delivery_route_items",
  payrollRecords: "payroll_records",
  dailyReports: "daily_reports",
  deletedOrders: "deleted_orders",
  auditLog: "audit_logs"
};

function impactedResources() {
  const names = new Set();
  const text = changed.map((file) => exists(file) ? read(file) : "").join("\n");
  for (const resource of registry) {
    const cloud = mappingByState[resource] || resource;
    if (text.includes(resource) || text.includes(cloud)) names.add(resource);
  }
  for (const [resource, profile] of Object.entries(profiles)) {
    if (profile.files.some((file) => changed.includes(file))) names.add(resource);
  }
  if (changed.some((file) => file.startsWith("js/core/sync") || file.startsWith("js/core/conflict"))) {
    registry.forEach((resource) => names.add(resource));
  }
  return [...names].filter((resource) => registry.includes(resource));
}

const impacted = impactedResources();

for (const resource of impacted) {
  const profile = profiles[resource];
  assert(profile, `${resource}: no runtime adaptation profile exists`);
  const source = profile.files.filter(exists).map(read).join("\n");
  assert(registry.includes(resource), `${resource}: runtime surface is not present in sync registry`);
  if (profile.runtimeManaged) {
    assert(source.includes(`state.${profile.state}`) || source.includes(profile.state), `${resource}: mutation/state surface not found`);
    assert(source.includes("persistState"), `${resource}: persistence boundary not connected`);
  }
}

if (changed.some((file) => file.includes("group-membership-sync-bridge.js"))) {
  assert(!/window\.persistState\s*=\s*function/.test(groupBridge), "group membership bridge must not wrap canonical persistState; use an explicit reconciliation hook instead");
}

const summary = {
  processor: "JARVIS 8.0",
  mode: "runtime adaptation audit",
  changedFiles: changed.length,
  impactedResources: impacted,
  runtimeManagedResources: impacted.filter((r) => profiles[r]?.runtimeManaged),
  referenceOnlyResources: impacted.filter((r) => profiles[r]?.runtimeManaged === false),
  runtimeLayers: ["mutation", "state", "persistence", "queue", "cloud", "conflict", "hydration", "render"],
  result: "PASS"
};

console.log("JARVIS 8.0 RUNTIME ADAPTATION AUDIT: PASS");
console.log(JSON.stringify(summary, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "## JARVIS 8.0 — Runtime Adaptation Audit",
    `- Changed files: **${summary.changedFiles}**`,
    `- Impacted synchronized resources: **${impacted.length ? impacted.join(", ") : "none detected"}**`,
    `- Runtime-managed resources: **${summary.runtimeManagedResources.length}**`,
    `- Reference-only resources: **${summary.referenceOnlyResources.length}**`,
    "- Runtime layers: mutation → state → persistence → queue → cloud → conflict → hydration → render",
    "- Result: **PASS**",
    ""
  ].join("\n"));
}
