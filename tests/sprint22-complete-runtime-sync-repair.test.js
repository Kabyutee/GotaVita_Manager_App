const fs = require("node:fs");
const assert = require("node:assert/strict");

const repair = fs.readFileSync("js/core/sync-complete-runtime-repair.js", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");
const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");

assert.match(repair, /selectResource\(resource\)/);
assert.match(repair, /upsertResource\(resource, localWrites\)/);
assert.match(repair, /remoteMerges/);
assert.match(repair, /timeOf\(remoteRow\) > timeOf\(localRow\)/);
assert.match(repair, /timeOf\(localRow\) > timeOf\(remoteRow\)/);
assert.match(repair, /replaceState\(state\)/);
assert.match(repair, /writeLocalStateSnapshot/);
assert.match(repair, /GVSync = Object\.freeze/);
assert.match(worker, /sync-complete-runtime-repair\.js/);
assert.match(manager, /hydrateFirstBaseline/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);

console.log("Sprint 22 complete runtime synchronization repair contract: PASS");
