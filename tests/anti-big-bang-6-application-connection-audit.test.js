const fs = require("fs");
const path = require("path");
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(`ANTI BIG BANG 6 CONNECTION AUDIT: ${message}`); }
function filesUnder(dir) {
  const root = path.join(process.cwd(), dir); if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full); else if (/\.(js|html|json|yml|yaml)$/.test(entry.name)) out.push(full);
    }
  };
  walk(root); return out;
}

const index = read("index.html");
const state = read("js/core/state.js");
const gateway = read("js/core/data-gateway.js");
const syncManager = read("js/core/sync-manager.js");
const syncStatus = read("js/core/sync-status.js");
const config = read("js/core/config.js");
const worker = read("worker.js");
const riskGate = read(".github/workflows/anti-big-bang-risk-gate.yml");
const moduleText = filesUnder("js/modules").map((file) => read(path.relative(process.cwd(), file))).join("\n");
const l300Runs = read("js/modules/daily-l300-runs.js");

const stateBlock = state.match(/return\s*\{([\s\S]*?)\};/);
assert(stateBlock, "state factory resource declaration not found");
const requiredResources = ["products","clients","services","orders","payments","expenses","payrollRecords","employees","orderGroups","deliveryRoutes","orderGroupItems","deliveryRouteItems","dailyReports","deletedOrders","auditLog"];
for (const resource of requiredResources) assert(new RegExp(`(?:^|,)\\s*${resource}\\s*:`).test(stateBlock[1]), `state resource missing: ${resource}`);

const syncRegistry = config.match(/SYNC_RESOURCES:Object\.freeze\(\[([\s\S]*?)\]\)/);
assert(syncRegistry, "SYNC_RESOURCES registry not found");
for (const resource of requiredResources) assert(syncRegistry[1].includes(`\"${resource}\"`), `config SYNC_RESOURCES missing: ${resource}`);

for (const required of ["SUPPORTED_RESOURCES", "selectResource(", "upsertResource(", "transactionResources:", "supportedResources:"]) assert(gateway.includes(required), `gateway capability missing: ${required}`);
assert(/async function requireAuthenticatedManager\(/.test(gateway), "gateway authentication boundary missing: requireAuthenticatedManager");

const requiredMappings = {
  orders: "orders", clients: "clients", products: "products", expenses: "expenses",
  employees: "employees", payroll_records: "payrollRecords", order_groups: "orderGroups",
  delivery_routes: "deliveryRoutes", order_group_items: "orderGroupItems", delivery_route_items: "deliveryRouteItems",
  daily_reports: "dailyReports", deleted_orders: "deletedOrders", services: "services", payments: "payments"
};
for (const [cloud, stateName] of Object.entries(requiredMappings)) assert(syncManager.includes(`\"${cloud}\"`) && syncManager.includes(`\"${stateName}\"`), `v2 mapping missing: ${cloud} -> ${stateName}`);
assert(syncManager.includes("window.GVSync = Object.freeze"), "canonical sync coordinator missing");
assert(syncManager.includes("gotavita_sync_baseline_v2"), "v2 baseline missing");
assert(syncManager.includes("gotavita_sync_outbox_v2"), "v2 outbox missing");
assert(syncManager.includes("finalRead"), "canonical remote read-back missing");
assert(syncManager.includes("concurrentMutationDetected"), "concurrency protection missing");
assert(syncManager.includes("startRealtime") && syncManager.includes("requestRealtimeSync"), "Realtime invalidation boundary missing");
assert(syncManager.includes("deletedOrders"), "deleted-order tombstone state is not retained");
assert(!syncManager.includes("auditLog: \"audit_logs\""), "audit logs must not be hydrated into the v2 business-state map");
assert(!syncManager.includes("GVConflictIntegration"), "legacy conflict engine still owns synchronization");
assert(!syncManager.includes("queueSyncResources"), "legacy resource queue still owns synchronization");

assert(!syncStatus.includes("setInterval("), "sync-status must not own a scheduler");
assert(!syncStatus.includes("GVData.selectResource"), "sync-status must not read cloud data");
assert(!syncStatus.includes("GVData.upsertResource"), "sync-status must not write cloud data");

const tabs = ["dashboard","neworder","orderlog","expenses","groups","clients","employees","reports"];
for (const tab of tabs) assert(index.includes(`data-tab=\"${tab}\"`), `UI tab missing: ${tab}`);

const requiredModules = ["js/modules/orders.js", "js/modules/clients.js", "js/modules/products.js", "js/modules/expenses.js", "js/modules/groups-routes.js", "js/modules/employees-payroll.js", "js/modules/reports.js", "js/modules/containers.js", "js/modules/backups.js"];
for (const file of requiredModules) assert(index.includes(file), `module missing from index.html: ${file}`);

for (const [feature, tokens] of [["orders", ["state.orders", "persistState"]],["clients", ["state.clients", "persistState"]],["products", ["state.products", "persistState"]],["expenses", ["state.expenses", "persistState"]],["groups/routes", ["state.orderGroups", "persistState"]],["employees/payroll", ["state.employees", "persistState"]],["reports", ["state.dailyReports", "persistState"]]]) for (const token of tokens) assert(moduleText.includes(token), `${feature} missing source evidence: ${token}`);

assert(state.includes("dailyRuns:[]"), "dailyRuns state resource missing");
assert(l300Runs.includes('timeWindow: "Morning"') && l300Runs.includes('timeWindow: "After Lunch"') && l300Runs.includes('timeWindow: "Before Dinner"'), "L300 daily schedule windows missing");
assert(l300Runs.includes('area: "ALABANG"'), "L300 Alabang routing metadata missing");
assert(l300Runs.includes("groupId") && l300Runs.includes("state.orderGroups") && l300Runs.includes("function groupForRun"), "L300 is not connected to canonical Group Orders");
assert(l300Runs.includes("openGroupManagerForDailyL300"), "L300 Group Orders management bridge missing");
assert(!l300Runs.includes("byExplicitRun"), "L300 must not maintain a second independent order source outside Group Orders");
assert(state.includes("loadDailyL300Module") && !state.includes("loadL300ReportingAdapter") && !state.includes("loadL300OperationsDashboard"), "L300 runtime must expose exactly one canonical dashboard loader");
assert((state.match(/loadDailyL300Module\(/g) || []).length >= 1, "canonical L300 loader not wired");

assert(worker.includes("LEGACY_API_RETIRED"), "legacy API boundary missing");
assert(!worker.includes("sync-cloud-write-reconciler") && !worker.includes("order-remote-pull-fix"), "Worker still contains hidden sync injection");
assert(riskGate.includes("canonical-sync-v2-architecture.test.js"), "canonical v2 architecture gate not wired into ANTI BIG BANG");
assert(riskGate.includes("canonical-sync-v2-simulation.test.js"), "canonical v2 simulation gate not wired into ANTI BIG BANG");
assert(riskGate.includes("canonical-sync-v2-bootstrap-safety.test.js"), "bootstrap safety gate not wired into ANTI BIG BANG");

console.log("ANTI BIG BANG 6 — FULL APPLICATION CONNECTION AUDIT: PASS");
console.log(JSON.stringify({ resources: requiredResources.length, hydratedBusinessResources: Object.keys(requiredMappings).length, uiTabs: tabs.length, modulesChecked: requiredModules.length, realtime: "GVSync invalidation", scheduler: "GVSync", auditLog: "append-only-not-hydrated", result: "PASS" }, null, 2));