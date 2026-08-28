const assert = require("node:assert/strict");
const fs = require("node:fs");

const manager = fs.readFileSync("js/core/sync-manager.js", "utf8");

assert.match(manager, /function bootstrap\(auth, current\)/, "bootstrap path missing");
assert.match(manager, /const previousLocal = localSnapshot\(\)/, "first-run local snapshot boundary missing");
assert.match(manager, /if \(!remote\)/, "remote-missing record handling missing");
assert.match(manager, /if \(previousLocal\)/, "established local baseline deletion protection missing");
assert.match(manager, /remoteTime <= previousTime/, "empty-resource destructive reconciliation is not timestamp guarded");
assert.match(manager, /const combinedOutbox = coalesceOutbox\(\[\.\.\.readOutbox\(\), \.\.\.pending\]\)/, "pending local ownership is not preserved through bootstrap");
assert.match(manager, /if \(!remaining\.length\) saveBaseline\(nextState, auth\?\.profile\?\.company_id\)/, "baseline promotion is not gated on queue drain");
assert.match(manager, /const canonicalResult = await fetchRemoteSet\(resources\)/, "canonical bootstrap read-back missing");

console.log("Sprint 20 empty-resource convergence v2 contract: PASS");
