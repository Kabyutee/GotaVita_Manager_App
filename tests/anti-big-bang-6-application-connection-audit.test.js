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
const conflict = read("js/core/conflict-resolution-integration.js");
const syncManager = read("js/core/sync-manager.js");
const config = read("js/core/config.js");
const riskGate = read(".github/workflows/anti-big-bang-risk-gate.yml");
const moduleText = filesUnder("js/modules").map((file) => read(path.relative(process.cwd(), file))).join("\n");
const l300Runs = read("js/modules/daily-l300-runs.js");

const stateBlock = state.match(/return\s*\{([\s\S]*?)\};/);
assert(stateBlock, "state factory resource declaration not found");
const businessResources = ["products","clients","services","orders","payments","expenses","payrollRecords","employees","orderGroups","deliveryRoutes","orderGroupItems","deliveryRouteItems","dailyReports","deletedOrders"];
for (const resource of businessResources) assert(new RegExp(`(?:^|,)\\s*${resource}\\s*:`).test(stateBlock[1]), `state resource missing: ${resource}`);
assert(/(?:^|,)\s*auditLog\s*:/.test(stateBlock[1]), "state auditLog resource missing");

const syncRegistry = config.match(/SYNC_RESOURCES:Object\.freeze\(\[([\s\S]*?)\]\)/);
assert(syncRegistry, "SYNC_RESOURCES registry not found");
for (const resource of businessResources) assert(syncRegistry[1].includes(`\"${resource}\"`), `config SYNC_RESOURCES missing business resource: ${resource}`);
assert(!syncRegistry[1].includes("\"auditLog\""), "auditLog must not be registered as canonical business sync state");
assert(/audit_log is an append-only history stream, not canonical business state/.test(config), "config must document the audit boundary");

for (const required of ["SUPPORTED_RESOURCES", "selectResource(", "upsertResource(", "transactionResources:", "supportedResources:"]) assert(gateway.includes(required), `gateway capability missing: ${required}`);
assert(/async function requireAuthenticatedManager\(/.test(gateway), "gateway authentication boundary missing: requireAuthenticatedManager");
assert(gateway.includes('"audit_logs"'), "gateway must retain dedicated audit_logs support");
assert(/name\s*===\s*"audit_logs"[\s\S]*?\.insert\(/.test(gateway), "audit_logs must retain its dedicated append-only insert path");

const requiredMappings = { orderGroups: "order_groups", deliveryRoutes: "delivery_routes", orderGroupItems: "order_group_items", deliveryRouteItems: "delivery_route_items", dailyReports: "daily_reports", deletedOrders: "deleted_orders", auditLog: "audit_logs" };
const requiredReverseMappings = { order_groups: "orderGroups", delivery_routes: "deliveryRoutes", order_group_items: "orderGroupItems", delivery_route_items: "deliveryRouteItems", daily_reports: "dailyReports", deleted_orders: "deletedOrders", audit_logs: "auditLog" };
function mappingExists(text, key, value) {
  const pattern = new RegExp(`(?:^|[,{])\\s*${key}\\s*:\\s*[\\"']${value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}['\\"]`);
  return pattern.test(text);
}
for (const [key, value] of Object.entries(requiredMappings)) assert(mappingExists(conflict, key, value), `conflict mapping missing: ${key}: ${value}`);
for (const [key, value] of Object.entries(requiredReverseMappings)) assert(mappingExists(conflict, key, value), `conflict reverse mapping missing: ${key}: ${value}`);

for (const required of ["hydrateFirstBaseline(", "flush(", "startPolling(", "window.GVSync = Object.freeze"]) assert(syncManager.includes(required), `canonical sync coordinator missing: ${required}`);
for (const forbidden of ["window.GVData.sync =", "GVData.sync = async", "window.GVData.sync = async"]) assert(!syncManager.includes(forbidden), `GVSync must not decorate GVData.sync: ${forbidden}`);

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

assert(riskGate.includes("anti-big-bang-6-application-connection-audit.test.js"), "full application connection audit not wired into ANTI BIG BANG");
assert(riskGate.includes("l300-group-order-contract.test.js"), "L300 Group Orders contract not wired into ANTI BIG BANG");

console.log("ANTI BIG BANG 6 — FULL APPLICATION CONNECTION AUDIT: PASS");
console.log(JSON.stringify({ businessResources: businessResources.length, auditLogState: true, auditLogCanonicalSync: false, uiTabs: tabs.length, modulesChecked: requiredModules.length, l300Runs: 3, scheduler: "GVSync", l300Authority: "OrderGroups", l300Presentation: "single-dashboard-panel" }, null, 2));
