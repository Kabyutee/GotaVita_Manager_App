const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync(
  "js/core/conflict-resolution-integration.js",
  "utf8"
);

const context = {
  console,
  navigator: { onLine: true },
  location: { protocol: "https:" },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  window: {
    addEventListener() {},
    GVData: {
      isConfigured: () => true,
      supportedResources: () => [],
      selectResource: async () => [],
      upsertResource: async () => [],
      requireAuthenticatedManager: async () => ({ authenticated: true })
    },
    GVConflictDetector: {
      rowKey: (row) => row?.id == null ? null : String(row.id),
      resolveConflictPolicy(local, remote, baselineAt) {
        const baseline = Date.parse(baselineAt);
        const lu = local?.updatedAt ? Date.parse(local.updatedAt) : null;
        const ru = remote?.updatedAt ? Date.parse(remote.updatedAt) : null;
        const ld = local?.deleted === true;
        const rd = remote?.deleted === true;
        const ldt = local?.deletedAt ? Date.parse(local.deletedAt) : null;
        const rdt = remote?.deletedAt ? Date.parse(remote.deletedAt) : null;
        if (![baseline, lu, ru].every(Number.isFinite)) return { action: "manual-review", reason: "indeterminate", mutation: false };
        if (ld !== rd) {
          if (ldt != null && ldt > ru) return { action: "keep-local", reason: "local-deletion-newer", mutation: false };
          if (rdt != null && rdt > lu) return { action: "keep-remote", reason: "remote-deletion-newer", mutation: false };
          return { action: "manual-review", reason: "deletion-vs-update-ambiguous", mutation: false };
        }
        const lc = lu > baseline;
        const rc = ru > baseline;
        if (!lc && !rc) return { action: "no-conflict", reason: "unchanged-since-baseline", mutation: false };
        if (lc && !rc) return { action: "keep-local", reason: "local-only-change", mutation: false };
        if (rc && !lc) return { action: "keep-remote", reason: "remote-only-change", mutation: false };
        if (lu > ru) return { action: "keep-local", reason: "local-newer", mutation: false };
        if (ru > lu) return { action: "keep-remote", reason: "remote-newer", mutation: false };
        return { action: "manual-review", reason: "same-timestamp", mutation: false };
      }
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context);

const plan = context.window.GVConflictIntegration.buildResolutionPlan(
  [
    { id: "local-only", updatedAt: "2026-08-20T02:00:00.000Z", value: 1 },
    { id: "newer-local", updatedAt: "2026-08-20T03:00:00.000Z", value: 2 },
    { id: "newer-remote", updatedAt: "2026-08-20T02:00:00.000Z", value: 3 },
    { id: "same-time", updatedAt: "2026-08-20T02:00:00.000Z", value: 4 },
    { id: "unchanged", updatedAt: "2026-08-20T00:00:00.000Z", value: 5 }
  ],
  [
    { id: "local-only", updatedAt: "2026-08-20T00:00:00.000Z", value: 0 },
    { id: "newer-local", updatedAt: "2026-08-20T02:00:00.000Z", value: 0 },
    { id: "newer-remote", updatedAt: "2026-08-20T03:00:00.000Z", value: 0 },
    { id: "same-time", updatedAt: "2026-08-20T02:00:00.000Z", value: 0 },
    { id: "unchanged", updatedAt: "2026-08-20T00:00:00.000Z", value: 5 }
  ],
  "2026-08-20T01:00:00.000Z"
);

function action(id) {
  return plan.find((x) => x.id === id)?.action;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(action("local-only") === "keep-local", "Local-only change must keep local");
assert(action("newer-local") === "keep-local", "Local newer must keep local");
assert(action("newer-remote") === "keep-remote", "Remote newer must keep remote");
assert(action("same-time") === "manual-review", "Same timestamp must require manual review");
assert(action("unchanged") === "no-conflict", "Unchanged records must remain conflict-free");

const deletionPlan = context.window.GVConflictIntegration.buildResolutionPlan(
  [],
  [{ id: "delete-local", updatedAt: "2026-08-20T01:30:00.000Z", value: 1 }],
  "2026-08-20T01:00:00.000Z",
  [{ id: "delete-local", archivedAt: "2026-08-20T02:00:00.000Z" }],
  []
);
assert(deletionPlan[0].action === "keep-local", "Newer local deletion must keep local");

const before = JSON.stringify(plan);
const summary = context.window.GVConflictIntegration.summarize(plan);
const after = JSON.stringify(plan);
assert(before === after, "Planning must not mutate decisions or source rows");
assert(summary.manualReview >= 1, "Ambiguous cases must be preserved for manual review");
assert(summary.keepLocal >= 1 && summary.keepRemote >= 1, "Plan must contain both unambiguous winner directions");

console.log("Sprint 12 controlled conflict integration contract: PASS");
