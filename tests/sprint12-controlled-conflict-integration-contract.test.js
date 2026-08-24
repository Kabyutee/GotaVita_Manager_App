const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

const context = {
  console,
  navigator: { onLine: true },
  location: { protocol: "https:" },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  window: {
    addEventListener() {},
    getSyncQueue: () => [],
    setSyncQueue() {},
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const integration = context.window.GVConflictIntegration;
assert(integration, "Universal sync integration must initialize");

const local = { legacy_id: "client-1", name: "Alberto", phone: "old", updated_at: "2026-08-20T02:00:00.000Z" };
const remote = { ...local, phone: "new", updated_at: "2026-08-20T02:00:00.000Z" };

assert(
  integration.buildResolutionPlan("clients", [local], [remote], [], [])[0].action === "keep-remote",
  "Remote canonical edit must win when no local write is pending"
);

context.window.getSyncQueue = () => ["clients"];
assert(
  integration.buildResolutionPlan("clients", [local], [remote], [], [])[0].action === "keep-local",
  "Pending local edit must retain local authority"
);

context.window.getSyncQueue = () => ["clients"];
assert(
  integration.buildResolutionPlan("clients", [{ legacy_id: "client-2", name: "New" }], [], [], [])[0].action === "keep-local",
  "Pending local create must remain local until uploaded"
);

context.window.getSyncQueue = () => [];
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