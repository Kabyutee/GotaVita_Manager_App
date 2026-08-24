const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const store = new Map();
const handlers = {};
const window = {
  addEventListener(name, handler) { handlers[name] = handler; },
  GVData: {
    selectResource: async () => [],
    upsertResource: async () => {},
    deleteResourceByLegacyId: async () => {},
    supportedResources: () => ["clients", "orders", "deleted_orders"]
  },
  GVConflictDetector: { rowKey: (row) => row?.legacy_id ?? row?.id },
  getStateSnapshot: () => ({}),
  replaceState: () => {},
  persistState: () => {},
  getSyncQueue: () => [],
  setSyncQueue: () => {}
};

const context = {
  window,
  navigator: { onLine: true },
  location: { protocol: "https:" },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  console,
  setTimeout,
  Date
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: "conflict-resolution-integration.js" });
const integration = window.GVConflictIntegration;
assert(integration, "Universal sync integration must initialize");

const base = {
  legacy_id: "client-1",
  name: "Alberto",
  phone: "old",
  updated_at: "2026-08-24T10:00:00.000Z"
};
const remote = { ...base, phone: "new", updated_at: "2026-08-24T10:00:00.000Z" };

let plan = integration.buildResolutionPlan("clients", [base], [remote], [], []);
assert(plan.length === 1 && plan[0].action === "keep-remote" && plan[0].reason === "remote-canonical", "Remote Client edit must win without a pending local write");

window.getSyncQueue = () => ["clients"];
plan = integration.buildResolutionPlan("clients", [base], [remote], [], []);
assert(plan[0].action === "keep-local" && plan[0].reason === "pending-local-write", "Pending local Client write must retain local authority");

const localNew = { legacy_id: "client-2", name: "New Client", phone: "555" };
plan = integration.buildResolutionPlan("clients", [localNew], [], [], []);
assert(plan[0].action === "keep-local" && plan[0].reason === "pending-local-create-or-update", "Pending local create must upload to the cloud");

window.getSyncQueue = () => [];
plan = integration.buildResolutionPlan("clients", [base], [], [], []);
assert(plan[0].action === "preserve-local", "Missing Client rows without deletion evidence must be preserved");

plan = integration.buildResolutionPlan("orders", [{ legacy_id: "0000176", order_number: "0000176" }], [], [], []);
assert(plan[0].action === "preserve-local", "Missing Order without tombstone evidence must be preserved");

plan = integration.buildResolutionPlan(
  "orders",
  [{ legacy_id: "0000176", order_number: "0000176" }],
  [],
  [],
  [{ legacy_id: "0000176", archivedAt: "2026-08-24T10:00:00.000Z" }]
);
assert(plan[0].action === "delete-local" && plan[0].reason === "explicit-remote-deletion-evidence", "Remote Order deletion must require explicit tombstone evidence");

plan = integration.buildResolutionPlan(
  "orders",
  [],
  [{ legacy_id: "0000176", order_number: "0000176" }],
  [{ legacy_id: "0000176", archivedAt: "2026-08-24T10:00:00.000Z" }],
  []
);
assert(plan[0].action === "delete-remote" && plan[0].reason === "explicit-local-deletion-evidence", "Local Order deletion must not resurrect on the receiving cloud transaction");

assert(!plan.some((decision) => decision.action === "manual-review"), "Universal sync must not produce manual-review for normal resource reconciliation");

console.log("Sprint 21 universal canonical sync behavior contract: PASS");
