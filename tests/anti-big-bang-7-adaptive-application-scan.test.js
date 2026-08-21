const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();
const BASE_SHA = process.env.BASE_SHA || "";
const HEAD_SHA = process.env.HEAD_SHA || "HEAD";
const IGNORED_DIRS = new Set([".git", "node_modules", ".wrangler", "dist", "coverage"]);
const FILE_EXT = /\.(js|html|css|json|yml|yaml|md)$/i;

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function exists(file) { return fs.existsSync(path.join(ROOT, file)); }
function fail(message) { throw new Error(`JARVIS 7 ADAPTIVE APPLICATION SCAN: ${message}`); }
function assert(condition, message) { if (!condition) fail(message); }

function allFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (FILE_EXT.test(entry.name)) out.push(rel(full));
    }
  };
  walk(ROOT);
  return [...new Set(out)].sort();
}

function changedFiles() {
  if (!BASE_SHA) return [];
  const text = cp.execFileSync("git", ["diff", "--name-only", BASE_SHA, HEAD_SHA], { encoding: "utf8" });
  return text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function grepAll(files, token) {
  return files.filter((file) => {
    try { return read(file).includes(token); } catch (_) { return false; }
  });
}

function stateResources() {
  const source = read("js/core/state.js");
  const block = source.match(/return\s*\{([\s\S]*?)\};/);
  assert(block, "state factory declaration not found");
  return [...block[1].matchAll(/(?:^|,)\s*([A-Za-z0-9_]+)\s*:/g)].map((m) => m[1]);
}

function registryResources() {
  const source = read("js/core/config.js");
  const match = source.match(/SYNC_RESOURCES:Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert(match, "SYNC_RESOURCES registry not found");
  return [...match[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

function cloudMappings() {
  return {
    products: "products", clients: "clients", services: "services", orders: "orders", payments: "payments",
    expenses: "expenses", payrollRecords: "payroll_records", employees: "employees", orderGroups: "order_groups",
    deliveryRoutes: "delivery_routes", orderGroupItems: "order_group_items", deliveryRouteItems: "delivery_route_items",
    dailyReports: "daily_reports", deletedOrders: "deleted_orders", auditLog: "audit_logs"
  };
}

function conflictMappings() {
  const source = read("js/core/conflict-resolution-integration.js");
  const pairs = [];
  for (const m of source.matchAll(/(\w+):\s*"([a-z_]+)"/g)) pairs.push([m[1], m[2]]);
  return pairs;
}

function gatewayResources() {
  const source = read("js/core/data-gateway.js");
  const supported = [...source.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  return [...new Set(supported)].filter((x) => /^(orders|payments|expenses|payroll_records|order_groups|order_group_items|delivery_routes|delivery_route_items|daily_reports|deleted_orders|audit_logs|clients|products|services|employees)$/.test(x));
}

function impactedResources(changed, mapping) {
  const text = changed.map((f) => exists(f) ? read(f) : "").join("\n").toLowerCase();
  return Object.keys(mapping).filter((resource) => {
    const cloud = mapping[resource];
    return text.includes(resource.toLowerCase()) || text.includes(cloud);
  });
}

const all = allFiles();
const changed = changedFiles();
const state = stateResources();
const registry = registryResources();
const mapping = cloudMappings();
const conflict = conflictMappings();
const conflictState = new Set(conflict.map(([s]) => s));
const conflictCloud = new Set(conflict.map(([, c]) => c));
const gateway = new Set(gatewayResources());
const impacted = impactedResources(changed, mapping);

for (const required of [
  "index.html", "js/core/state.js", "js/core/config.js", "js/core/data-gateway.js",
  "js/core/conflict-resolution-integration.js", "js/core/sync-manager.js"
]) assert(exists(required), `application layer missing: ${required}`);

const conflictManaged = new Set([
  "orders", "payments", "expenses", "payrollRecords", "employees", "orderGroups", "deliveryRoutes",
  "orderGroupItems", "deliveryRouteItems", "dailyReports", "deletedOrders", "auditLog"
]);

const rows = state.map((resource) => {
  const cloud = mapping[resource];
  const references = grepAll(all, resource);
  const managed = conflictManaged.has(resource);
  const checks = {
    registry: registry.includes(resource),
    gateway: !cloud || gateway.has(cloud),
    conflictState: !managed || conflictState.has(resource),
    conflictCloud: !managed || conflictCloud.has(cloud),
    applicationReferences: references.length > 0
  };
  return { resource, cloud, conflictManaged: managed, impacted: impacted.includes(resource), refs: references.length, checks };
});

for (const row of rows) {
  for (const [name, ok] of Object.entries(row.checks)) assert(ok, `${row.resource}: ${name} disconnected`);
}

const summary = {
  processor: "JARVIS 7.0",
  mode: "adaptive whole-application scan",
  filesScanned: all.length,
  changedFiles: changed.length,
  resourcesScanned: rows.length,
  conflictManagedResources: [...conflictManaged],
  impactedResources: impacted,
  layers: ["UI", "state", "registry", "gateway", "conflict", "sync", "application references"],
  result: "PASS"
};

console.log("JARVIS 7.0 ADAPTIVE WHOLE-APPLICATION SCAN: PASS");
console.log(JSON.stringify(summary, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "## JARVIS 7.0 — Adaptive Whole-Application Scan",
    `- Files scanned: **${summary.filesScanned}**`,
    `- Changed files: **${summary.changedFiles}**`,
    `- Resources scanned: **${summary.resourcesScanned}**`,
    `- Conflict-managed resources: **${summary.conflictManagedResources.length}**`,
    `- Impacted resources: **${impacted.length ? impacted.join(", ") : "none detected"}**`,
    "- Result: **PASS**",
    "- Every PR is rescanned against the full application graph; impacted consumers must remain connected.",
    ""
  ].join("\n"));
}
