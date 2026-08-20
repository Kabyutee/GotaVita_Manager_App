const fs = require("node:fs");
const assert = require("node:assert/strict");
const script = fs.readFileSync("js/core/sync-manager.js", "utf8");
assert.match(script, /function syncResultRequiresRender\(/);
assert.match(script, /if \(syncResultRequiresRender\(result\)\) \{\s*renderSyncedState\(\);\s*\}/);
assert.doesNotMatch(script, /const result = await window\.GVData\.sync\(true\);[\s\S]*?if \(result !== false\) \{\s*renderSyncedState\(\);/);
console.log("Sprint 17 Order Log interaction preservation contract: PASS");
