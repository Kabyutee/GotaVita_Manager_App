const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

const window = {
  GVData: {
    supportedResources: () => [
      "clients",
      "products",
      "employees",
      "orders",
      "audit_logs"
    ],
    selectResource: async () => [],
    upsertResource: async () => [],
    deleteResourceByLegacyId: async () => []
  },
  getStateSnapshot: () => ({ clients: [], products: [], employees: [], orders: [] }),
  replaceState: () => {},
  persistState: () => true,
  getSyncQueue: () => [],
  setSyncQueue: () => {}
};

const context = {
  window,
  navigator: { onLine: true },
  location: { protocol: "https:" },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  console,
  setTimeout,
  Date
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: "conflict-resolution-integration.js" });

const integration = window.GVConflictIntegration;
assert(integration, "Universal sync integration must initialize");

const resources = integration.supportedResources();

assert(resources.includes("clients"), "Clients must remain in canonical synchronization");
assert(resources.includes("orders"), "Orders must remain in canonical synchronization");
assert(!resources.includes("auditLog"), "auditLog must never be a whole-state sync resource");
assert(!resources.includes("audit_logs"), "audit_logs must never be a whole-state sync resource");

console.log("Sprint 21 audit-log canonical boundary contract: PASS");
