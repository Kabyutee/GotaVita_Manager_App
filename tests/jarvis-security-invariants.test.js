const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");

assert.match(gateway, /requireAuthenticatedManager/);
assert.match(gateway, /company_id/);
assert.doesNotMatch(gateway, /service_role|service-role/i);
assert.match(manager, /window\.GVAuth\?\.isAuthorized/);
assert.doesNotMatch(manager, /GVConflictIntegration/);
assert.doesNotMatch(manager, /Math\.random\(\)/);
assert.match(manager, /deleted_orders/);
assert.match(manager, /concurrentMutationDetected/);
assert.match(worker, /LEGACY_API_RETIRED/);
assert.doesNotMatch(worker, /sync-cloud-write-reconciler/);
assert.doesNotMatch(worker, /order-remote-pull-fix/);

console.log("JARVIS security invariants contract: PASS");
