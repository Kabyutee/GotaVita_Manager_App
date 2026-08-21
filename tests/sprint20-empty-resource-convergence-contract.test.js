const assert = require("node:assert/strict");

function shouldClearRemoteEmpty({ baselineState, resource, queuedResources }) {
  return Boolean(
    baselineState &&
    Object.prototype.hasOwnProperty.call(baselineState, resource) &&
    !queuedResources.includes(resource)
  );
}

assert.equal(
  shouldClearRemoteEmpty({ baselineState: null, resource: "clients", queuedResources: [] }),
  false,
  "first-run empty cloud must preserve local seed data"
);

assert.equal(
  shouldClearRemoteEmpty({ baselineState: { clients: [{ id: "c1" }] }, resource: "clients", queuedResources: [] }),
  true,
  "an established cloud baseline must allow a successful empty remote resource to clear stale local rows"
);

assert.equal(
  shouldClearRemoteEmpty({ baselineState: { clients: [{ id: "c1" }] }, resource: "clients", queuedResources: ["clients"] }),
  false,
  "pending local queue ownership must defer destructive empty-resource reconciliation"
);

console.log("Sprint 20 empty-resource convergence contract: PASS");
