const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(`ANTI BIG BANG 6 CONNECTION AUDIT: ${message}`); }
function filesUnder(dir) {
  const root = path.join(ROOT, dir); if (!fs.existsSync(root)) return [];
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
const conflict = read("js/core/conflict-resolution-integration.js");
const syncManager = read("js/core/sync-manager.js");
const config = read("js/core/config.js");
const riskGate = read(".github/workflows/anti-big-bang-risk-gate.yml");
const moduleText = filesUnder("js/modules").map((file) => read(path.relative(ROOT, file))).join("\n");

const stateBlock = state.match(/return\s*\{([\s\S]*?)\};/);
assert(stateBlock, "state factory resource declaration not found");
const requiredResources = [
  "products", "clients", "services", "orders", "payments", "expenses", "payrollRecords", "employees",
  "orderGroups", "deliveryRoutes", "orderGroupItems", "deliveryRouteItems", "dailyReports", "deletedOrders", "auditLog"
];
for (const resource of requiredResources) assert(new RegExp(`(?:^|,)\\s*${resource}\\s*:`).test(stateBlock[1]), `state resource missing: ${resource}`);

const syncRegistry = config.match(/SYNC_RESOURCES:Object\.freeze\(\[([\s\S]*?)\]\)/);
assert(syncRegistry, "SYNC_RESOURCES registry not found");
for (const resource of requiredResources) assert(syncRegistry[1].includes(`\"${resource}\"`), `config SYNC_RESOURCES missing: ${resource}`);

for (const required of ["SUPPORTED_RESOURCES", "selectResource(", "upsertResource(", "transactionResources:", "supportedResources:", "requireAuthenticatedManager:"]) {
  assert(gateway.includes(required), `gateway capability missing: ${required}`);
}
for (const required of [
  "orderGroups: \"order_groups\"", "deliveryRoutes: \"delivery_routes\"", "orderGroupItems: \"order_group_items\"",
  "deliveryRouteItems: \"delivery_route_items\"", "dailyReports: \"daily_reports\"", "deletedOrders: \"deleted_orders\"", "auditLog: \"audit_logs\"",
  "order_groups: \"orderGroups\"", "delivery_routes: \"deliveryRoutes\"", "order_group_items: \"orderGroupItems\"",
  "delivery_route_items: \"deliveryRouteItems\"", "daily_reports: \"dailyReports\"", "deleted_orders: \"deletedOrders\"", "audit_logs: \"auditLog\""
]) assert(conflict.includes(required), `conflict mapping missing: ${required}`);

for (const required of ["hydrateFirstBaseline(", "flush(", "startPolling(", "window.GVSync = Object.freeze"]) {
  assert(syncManager.includes(required), `canonical sync coordinator missing: ${required}`);
}
for (const forbidden of ["window.GVData.sync =", "GVData.sync = async", "window.GVData.sync = async"]) {
  assert(!syncManager.includes(forbidden), `GVSync must not decorate GVData.sync: ${forbidden}`);
}

const tabs = ["dashboard", "neworder", "orderlog", "expenses", "groups", "clients", "employees", "reports"];
for (const tab of tabs) assert(index.includes(`data-tab=\"${tab}\"`), `UI tab missing: ${tab}`);

const requiredModules = [
  "js/modules/orders.js", "js/modules/clients.js", "js/modules/products.js", "js/modules/expenses.js",
  "js/modules/groups-routes.js", "js/modules/employees-payroll.js", "js/modules/reports.js", "js/modules/containers.js", "js/modules/backups.js"
];
for (const file of requiredModules) assert(index.includes(file), `module missing from index.html: ${file}`);

for (const [feature, tokens] of [
  ["orders", ["state.orders", "persistState"]], ["clients", ["state.clients", "persistState"]],
  ["products", ["state.products", "persistState"]], ["expenses", ["state.expenses", "persistState"]],
  ["groups/routes", ["state.orderGroups", "persistState"]], ["employees/payroll", ["state.employees", "persistState"]],
  ["reports", ["state.dailyReports", "persistState"]]
]) for (const token of tokens) assert(moduleText.includes(token), `${feature} missing source evidence: ${token}`);

assert(riskGate.includes("anti-big-bang-6-application-connection-audit.test.js"), "full application connection audit not wired into ANTI BIG BANG");

console.log("ANTI BIG BANG 6 — FULL APPLICATION CONNECTION AUDIT: PASS");
console.log(JSON.stringify({ resources: requiredResources.length, uiTabs: tabs.length, modulesChecked: requiredModules.length, scheduler: "GVSync" }, null, 2));
