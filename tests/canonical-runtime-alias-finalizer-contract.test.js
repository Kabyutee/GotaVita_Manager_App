const fs = require("node:fs");
const assert = require("node:assert/strict");

const index = fs.readFileSync("index.html", "utf8");
const finalizer = fs.readFileSync("js/core/canonical-runtime-alias-finalizer.js", "utf8");
const syncManager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const script = fs.readFileSync("script.js", "utf8");

const scriptIndex = index.indexOf('src="script.js"');
const finalizerIndex = index.indexOf('src="js/core/canonical-runtime-alias-finalizer.js"');

assert.ok(scriptIndex >= 0, "legacy script.js must remain loaded");
assert.ok(finalizerIndex >= 0, "canonical runtime alias finalizer must be loaded");
assert.ok(finalizerIndex > scriptIndex, "finalizer must execute after script.js so legacy globals cannot win");

assert.match(finalizer, /window\.syncChangedResources\s*=\s*\(reason\)\s*=>\s*\n?\s*window\.GVSync\.flush/);
assert.match(finalizer, /window\.syncNow\s*=\s*\(\)\s*=>\s*\n?\s*window\.GVSync\.flush/);
assert.match(syncManager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(syncManager, /window\.syncChangedResources\s*=\s*\(reason\)\s*=>\s*window\.GVSync\.flush/);
assert.match(script, /function\s+syncChangedResources\s*\(/, "legacy sync function remains present for compatibility");
assert.match(script, /function\s+syncNow\s*\(/, "legacy syncNow function remains present for compatibility");

console.log("Canonical runtime alias precedence contract: PASS");
