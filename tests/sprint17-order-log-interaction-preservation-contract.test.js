const fs = require("node:fs");
const assert = require("node:assert/strict");

const script = fs.readFileSync("js/core/sync-manager.js", "utf8");

assert.match(script, /function interactionIsProtected\(/);
assert.match(script, /function beginUserInteraction\(/);
assert.match(script, /function endUserInteractionSoon\(/);
assert.match(script, /function syncResultRequiresRender\(/);
assert.match(
  script,
  /if \(syncResultRequiresRender\(result\)\) \{\s*renderSyncedState\(\);\s*\}/,
  "Background sync must render only when the sync result explicitly requires it"
);
assert.doesNotMatch(
  script,
  /const result = await window\.GVData\.sync\(true\);[\s\S]*?if \(result !== false\) \{\s*renderSyncedState\(\);/,
  "A generic successful sync result must not force a UI rebuild"
);
assert.match(
  script,
  /input, select, textarea, button/,
  "Interaction protection must cover native Order Log controls"
);

console.log("Sprint 17 Order Log interaction preservation contract: PASS");
