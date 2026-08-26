const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const configSource = read("js/core/config.js");
const authSource = read("js/core/auth.js");
const stateSource = read("js/core/state.js");
const managerSource = read("js/core/sync-manager.js");
const gatewaySource = read("js/core/data-gateway.js");

assert.match(configSource, /SYNC_RESOURCES/);
assert.match(authSource, /requireManagerSession/);
assert.match(authSource, /onAuthStateChange/);
assert.match(stateSource, /replaceState/);
assert.match(stateSource, /getStateSnapshot/);
assert.match(managerSource, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(managerSource, /hydrateFirstBaseline\(integration\)/);
assert.match(managerSource, /function\s+startPolling\s*\(/);
assert.match(gatewaySource, /async function selectResource/);
assert.match(gatewaySource, /async function upsertResource/);
assert.match(gatewaySource, /supportedResources/);

console.log("Application lifecycle and canonical registry contract: PASS");
