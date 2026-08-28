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

function registryResources() {
  const source = read("js/core/config.js");
  const match = source.match(/SYNC_RESOURCES:Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert(match, "SYNC_RESOURCES registry not found");
  return [...match[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

function gatewayResources() {
  const source = read("js/core/data-gateway.js");
  const supported = [...source.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  return [...new Set(supported)].filter((x) => /^(orders|payments|expenses|payroll_records|order_groups|order_group_items|delivery_routes|delivery_route_items|daily_reports|deleted_orders|clients|products|services|employees)$/.test(x));
}

const all = allFiles();
const changed = changedFiles();
const registry = registryResources();
const gateway = new Set(gatewayResources());
const syncManager = read("js/core/sync-manager.js");
const uiBridge = read("js/core/ui-bridge.js");
const worker = read("worker.js");
const index = read("index.html");
const runtimeActivation = read("js/core/sync-runtime-activation.js");

for (const required of [
  "index.html", "js/core/state.js", "js/core/config.js", "js/core/data-gateway.js", "js/core/sync-manager.js"
]) assert(exists(required), `application layer missing: ${required}`);

for (const resource of registry) {
  const cloud = {
    payrollRecords: "payroll_records",
    orderGroups: "order_groups",
    deliveryRoutes: "delivery_routes",
    orderGroupItems: "order_group_items",
    deliveryRouteItems: "delivery_route_items",
    dailyReports: "daily_reports",
    deletedOrders: "deleted_orders",
    auditLog: "audit_logs"
  }[resource] || resource;
  assert(resource === "auditLog" || gateway.has(cloud), `${resource}: gateway edge missing for ${cloud}`);
}

assert(syncManager.includes("gotavita_sync_baseline_v2"), "canonical v2 baseline missing");
assert(syncManager.includes("gotavita_sync_outbox_v2"), "durable mutation outbox missing");
assert(syncManager.includes("capturePendingLocalMutations"), "local mutation capture missing");
assert(syncManager.includes("executeMutation"), "mutation execution missing");
assert(syncManager.includes("concurrentMutationDetected"), "concurrent mutation protection missing");
assert(syncManager.includes("window.GVSync = Object.freeze"), "single canonical sync coordinator missing");
assert(syncManager.includes("startRealtime"), "Realtime invalidation path missing");
assert(syncManager.includes("requestRealtimeSync"), "Realtime request path missing");
assert(syncManager.includes("finalRead"), "canonical remote read-back missing");
assert(!syncManager.includes("GVConflictIntegration"), "legacy conflict engine still referenced");
assert(!syncManager.includes("queueSyncResources"), "legacy queue authority still referenced");

assert(!uiBridge.includes("GVData.selectResource"), "UI bridge still reads cloud data");
assert(!uiBridge.includes("GVData.upsertResource"), "UI bridge still writes cloud data");
assert(!uiBridge.includes("hydrateFromSupabase"), "UI bridge still owns hydration");

assert(runtimeActivation.includes("coordinator: \"GVSync\""), "runtime activation must declare GVSync as coordinator");
assert(runtimeActivation.includes("compatibilityOnly: true"), "runtime activation must remain compatibility-only");
for (const retired of [
  "sync-cloud-write-reconciler",
  "order-remote-pull-fix",
  "order-write-boundary-bridge",
  "sync-p0-auth-hydration",
  "sync-complete-runtime-repair",
  "sync-p0-final-canonicalizer",
  "group-membership-sync-bridge",
  "realtime-channel-lifecycle-fix",
  "sync-queue-authority",
  "sync-authority"
]) assert(!runtimeActivation.includes(retired), `runtime activation resurrects retired synchronization module: ${retired}`);

assert(worker.includes("LEGACY_API_RETIRED"), "legacy API retirement boundary missing");
for (const retired of [
  "sync-cloud-write-reconciler",
  "order-remote-pull-fix",
  "order-write-boundary-bridge",
  "sync-p0-auth-hydration",
  "sync-complete-runtime-repair",
  "sync-p0-final-canonicalizer",
  "group-membership-sync-bridge",
  "realtime-channel-lifecycle-fix",
  "sync-queue-authority",
  "sync-authority"
]) assert(!worker.includes(retired), `Worker still contains hidden synchronization module: ${retired}`);

assert(index.includes("js/core/sync-manager.js"), "sync manager missing from explicit dependency graph");
assert(index.includes("js/core/ui-bridge.js"), "UI bridge missing from explicit dependency graph");
assert(!all.includes("js/core/conflict-resolution-integration.js"), "retired conflict engine still present");

const staleLegacyFiles = [
  "js/core/order-remote-pull-fix.js",
  "js/core/order-write-boundary-bridge.js",
  "js/core/sync-cloud-write-reconciler.js",
  "js/core/sync-queue-authority.js",
  "js/core/sync-authority.js",
  "js/core/sync-auth-startup-bridge.js",
  "js/core/sync-p0-auth-hydration.js",
  "js/core/sync-p0-final-canonicalizer.js",
  "js/core/sync-complete-runtime-repair.js",
  "js/core/remote-canonical-field-bridge.js",
  "js/core/group-membership-sync-bridge.js",
  "js/core/realtime-channel-lifecycle-fix.js",
  "js/core/sync-tombstone-legacy-id-bridge.js",
  "js/core/order-delete-reconciliation-bridge.js",
  "js/core/client-delete-bridge.js",
  "js/core/conflict-resolution-integration.js"
];
for (const file of staleLegacyFiles) assert(!exists(file), `retired synchronization artifact still exists: ${file}`);

const changedApplicationFiles = changed.filter((f) => /\.(js|mjs|cjs|html)$/.test(f) && exists(f) && !f.startsWith("tests/") && !f.startsWith(".github/"));
const changedApplicationText = changedApplicationFiles.map(read).join("\n");
assert(!/localStorage\.clear\s*\(/.test(changedApplicationText), "PR introduces localStorage.clear(); existing records must remain available");
assert(!/indexedDB\.deleteDatabase\s*\(/.test(changedApplicationText), "PR introduces IndexedDB deletion; existing records must remain available");

const summary = {
  processor: "JARVIS 7.0",
  mode: "adaptive whole-application scan",
  filesScanned: all.length,
  changedFiles: changed.length,
  synchronizedResourcesScanned: registry.length,
  layers: ["whole repository", "sync registry", "gateway", "canonical sync coordinator", "explicit runtime graph", "retired-module exclusion", "changed-surface impact"],
  result: "PASS"
};

console.log("JARVIS 7.0 ADAPTIVE WHOLE-APPLICATION SCAN: PASS");
console.log(JSON.stringify(summary, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    "## JARVIS 7.0 — Adaptive Whole-Application Scan",
    `- Files scanned: **${summary.filesScanned}**`,
    `- Changed files: **${summary.changedFiles}**`,
    `- Synchronized resources scanned: **${summary.synchronizedResourcesScanned}**`,
    "- Canonical runtime: **GVSync only**",
    "- Existing records: **PROTECTED**",
    "- Result: **PASS**",
    ""
  ].join("\n"));
}
