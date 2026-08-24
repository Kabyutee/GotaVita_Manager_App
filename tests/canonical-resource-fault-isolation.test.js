const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/canonical-resource-recovery.js", "utf8");

const state = {
  clients: [],
  products: [],
  employees: [],
  orders: [],
  _meta: {}
};
let replaced = 0;
let rendered = 0;

const context = {
  console,
  Date,
  navigator: { onLine: true },
  window: {
    location: { protocol: "https:" },
    GVData: {
      isConfigured: () => true,
      requireAuthenticatedManager: async () => ({ authenticated: true }),
      supportedResources: () => ["clients", "products", "employees", "orders"],
      selectResource: async (resource) => {
        if (resource === "products") throw new Error("products adapter failure");
        return resource === "clients" ? [{ id: "c1" }, { id: "c2" }] :
          resource === "employees" ? [{ id: "e1" }] :
          resource === "orders" ? [{ id: "o1" }] : [];
      }
    },
    GVConflictIntegration: {
      supportedResources: () => ["clients", "products", "employees", "orders"],
      resourceCloudName: (resource) => resource === "employees" ? "employees" : resource,
      resourceStateName: (resource) => resource
    },
    getStateSnapshot: () => JSON.parse(JSON.stringify(state)),
    replaceState: (next) => { Object.assign(state, next); replaced++; },
    persistState: () => {},
    renderAll: () => { rendered++; }
  }
};

context.window.window = context.window;
vm.runInNewContext(source, context, { filename: "canonical-resource-recovery.js" });

(async () => {
  const result = await context.window.GVCanonicalResourceRecovery.recover();

  assert.equal(result.ok, true);
  assert.equal(state.clients.length, 2, "Clients must hydrate");
  assert.equal(state.employees.length, 1, "Employees must hydrate after another resource fails");
  assert.equal(state.orders.length, 1, "Orders must hydrate after another resource fails");
  assert.equal(state.products.length, 0, "Failed Products resource must not be treated as empty success");
  assert.equal(result.results.find((row) => row.resource === "products")?.status, "failed");
  assert.ok(replaced >= 1, "Recovered resources must update application state");
  assert.ok(rendered >= 1, "Recovered state must render");

  console.log("Canonical resource fault-isolation contract: PASS");
})();
