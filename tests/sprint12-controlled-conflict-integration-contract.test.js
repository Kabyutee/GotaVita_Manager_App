const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const queueState = { items: [] };
const context = {
  console,
  navigator: { onLine: true },
  location: { protocol: "https:" },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  window: {
    addEventListener() {},
    getSyncQueue: () => queueState.items,
    setSyncQueue(next) { queueState.items = Array.isArray(next) ? next : []; },
    GVData: {
      isConfigured: () => true,
      supportedResources: () => [],
      selectResource: async () => [],
      upsertResource: async () => [],
      deleteResourceByLegacyId: async () => [],
      requireAuthenticatedManager: async () => ({ authenticated: true })
    },
    GVConflictDetector: {
      rowKey: (row) => row?.legacy_id == null ? String(row?.id ?? "") : String(row.legacy_id)
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context);

const integration = context.window.GVConflictIntegration;
assert(integration, "Universal sync integration must initialize");

const local = { legacy_id: "client-1", name: "Alberto", phone: "old" };
const remote = { ...local, phone: "new" };

queueState.items = [];
assert(
  integration.buildResolutionPlan("clients", [local], [remote], [], [])[0].action === "keep-remote",
  "Remote canonical edit must win when no local write is pending"
);

queueState.items = ["clients"];
assert(
  integration.buildResolutionPlan("clients", [local], [remote], [], [])[0].action === "keep-local",
  "Pending local edit must retain local authority"
);
assert(
  integration.buildResolutionPlan("clients", [{ legacy_id: "client-2", name: "New" }], [], [], [])[0].action === "keep-local",
  "Pending local create must remain local until uploaded"
);

queueState.items = [];
assert(
  integration.buildResolutionPlan("clients", [local], [], [], [])[0].action === "preserve-local",
  "Missing Client without deletion evidence must be preserved"
);

assert(
  integration.buildResolutionPlan("orders", [{ legacy_id: "0000176" }], [], [], [])[0].action === "preserve-local",
  "Missing Order without tombstone must be preserved"
);

assert(
  integration.buildResolutionPlan(
    "orders",
    [{ legacy_id: "0000176" }],
    [],
    [],
    [{ legacy_id: "0000176", archivedAt: "2026-08-20T03:00:00.000Z" }]
  )[0].action === "delete-local",
  "Order deletion must require explicit remote tombstone evidence"
);

assert(
  integration.buildResolutionPlan(
    "orders",
    [],
    [{ legacy_id: "0000176" }],
    [{ legacy_id: "0000176", archivedAt: "2026-08-20T03:00:00.000Z" }],
    []
  )[0].action === "delete-remote",
  "A local Order tombstone must prevent resurrection on the receiving cloud"
);

console.log("Sprint 12 controlled conflict integration contract: PASS");