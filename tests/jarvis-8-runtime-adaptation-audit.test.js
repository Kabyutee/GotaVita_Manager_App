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
  return cp.execFileSync("git", ["diff", "--name-only", BASE_SHA, HEAD_SHA], { encoding: "utf8" }).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
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
  payrollRecords: { files: ["js/modules/employees-payroll.js"], owner: "employees" },
  orderGroups: { files: ["js/modules/groups-routes.js"], state: "orderGroups", runtimeManaged: true },
  orderGroupItems: { files: ["js/modules/groups-routes.js"], owner: "orderGroups" },
  deliveryRoutes: { files: ["js/modules/groups-routes.js"], runtimeManaged: false },
  deliveryRouteItems: { files: ["js/modules/groups-routes.js"], owner: "deliveryRoutes" },
  dailyReports: { files: ["js/modules/reports.js"], state: "dailyReports", runtimeManaged: true },
  deletedOrders: { files: ["js/modules/orders.js"], owner: "orders" },
  auditLog: { files: ["script.js"], referenceOnly: true },
  payments: { files: ["js/modules/orders.js"], owner: "orders" },
  services: { files: ["js/modules/products.js"], owner: "products" }
};

const changed = changedFiles();
const registry = registryResources();
const sync = read("js/core/sync-manager.js");
const gateway = read("js/core/data-gateway.js");
const status = read("js/core/sync-status.js");

for (const required of ["js/core/config.js", "js/core/data-gateway.js", "js/core/sync-manager.js", "script.js"]) {
  assert(exists(required), `runtime foundation missing: ${required}`);
}

assert(/gotavita_sync_baseline_v2/.test(sync), "canonical v2 baseline missing");
assert(/gotavita_sync_outbox_v2/.test(sync), "durable mutation outbox missing");
assert(/capturePendingLocalMutations/.test(sync), "local mutation capture missing");
assert(/executeMutation/.test(sync), "mutation execution boundary missing");
assert(/concurrentMutationDetected/.test(sync), "in-flight mutation protection missing");
assert(/startRealtime/.test(sync) && /requestRealtimeSync/.test(sync), "Realtime invalidation boundary missing");
assert(/finalRead/.test(sync), "remote read-back boundary missing");
assert(/window\.GVSync\s*=\s*Object\.freeze/.test(sync), "canonical sync authority missing");
assert(!/GVConflictIntegration/.test(sync), "legacy conflict engine remains in canonical coordinator");
assert(!/queueSyncResources/.test(sync), "legacy resource queue remains in canonical coordinator");
assert(!/setInterval\(.*sync-status/i.test(status), "sync-status must not own synchronization scheduling");
assert(/async function selectResource/.test(gateway) && /async function upsertResource/.test(gateway), "gateway CRUD boundary missing");

const mappingByState = {
  orderGroups: "order_groups", orderGroupItems: "order_group_items", deliveryRoutes: "delivery_routes",
  deliveryRouteItems: "delivery_route_items", payrollRecords: "payroll_records", dailyReports: "daily_reports",
  deletedOrders: "deleted_orders", auditLog: "audit_logs"
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
  if (changed.some((file) => file.startsWith("js/core/sync") || file === "js/core/ui-bridge.js" || file === "worker.js")) registry.forEach((resource) => names.add(resource));
  return [...names].filter((resource) => registry.includes(resource));
}

const impacted = impactedResources();
for (const resource of impacted) {
  const profile = profiles[resource];
  assert(profile, `${resource}: no runtime adaptation profile exists`);
  if (profile.runtimeManaged) {
    const source = profile.files.filter(exists).map(read).join("\n");
    assert(source.includes(`state.${profile.state}`) || source.includes(profile.state), `${resource}: mutation/state surface not found`);
    assert(source.includes("persistState"), `${resource}: persistence boundary not found`);
  }
  if (profile.owner) {
    const owner = profiles[profile.owner];
    assert(owner, `${resource}: owner profile ${profile.owner} missing`);
    assert(registry.includes(profile.owner), `${resource}: owner resource not synchronized`);
    const ownerSource = owner.files.filter(exists).map(read).join("\n");
    assert(ownerSource.includes("persistState"), `${resource}: owner workflow lacks persistence boundary`);
  }
}

const retired = [
  "js/core/conflict-resolution-integration.js",
  "js/core/group-membership-sync-bridge.js",
  "js/core/order-remote-pull-fix.js",
  "js/core/order-write-boundary-bridge.js",
  "js/core/sync-cloud-write-reconciler.js",
  "js/core/sync-queue-authority.js",
  "js/core/sync-authority.js",
  "js/core/sync-auth-startup-bridge.js",
  "js/core/sync-runtime-activation.js",
  "js/core/sync-p0-auth-hydration.js",
  "js/core/sync-p0-final-canonicalizer.js",
  "js/core/sync-complete-runtime-repair.js",
  "js/core/remote-canonical-field-bridge.js",
  "js/core/realtime-channel-lifecycle-fix.js",
  "js/core/sync-tombstone-legacy-id-bridge.js",
  "js/core/order-delete-reconciliation-bridge.js",
  "js/core/client-delete-bridge.js"
];
for (const file of retired) assert(!exists(file), `${file}: retired synchronization artifact still exists`);

console.log("JARVIS 8.0 RUNTIME ADAPTATION AUDIT: PASS");
console.log(JSON.stringify({ processor: "JARVIS 8.0", mode: "canonical sync v2 runtime ownership", changedFiles: changed.length, impactedResources: impacted, singleCoordinator: "GVSync", realtime: "invalidation-only", result: "PASS" }, null, 2));
