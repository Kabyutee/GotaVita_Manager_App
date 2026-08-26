const fs = require("node:fs");
const assert = require("node:assert/strict");

const worker = fs.readFileSync("worker.js", "utf8");
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const bridge = fs.readFileSync("js/core/order-write-boundary-bridge.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.doesNotMatch(worker, /sync-complete-runtime-repair\.js/);
assert.match(manager, /hydrateFirstBaseline\(integration\)/);
assert.match(manager, /window\.GVSync = Object\.freeze/);
assert.match(manager, /ensureConflictIntegration\(\)/);
assert.match(bridge, /channel\.on\(/);
assert.match(bridge, /channel\.subscribe\(/);
assert.match(bridge, /removeChannel/);
assert.match(bridge, /window\.GVData\.upsertResource|data\.upsertResource/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(gateway, /supportedResources/);

console.log("Sprint 22 canonical runtime synchronization contract: PASS");
