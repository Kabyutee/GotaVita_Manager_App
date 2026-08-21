const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

assert.doesNotMatch(
  bridge,
  /if \(!Object\.values\(cloudRows\)\.some\(\(rows\) => rows\.length > 0\)\) return \{ hydrated: false, reason: "cloud-empty" \};/,
  "successful empty cloud reads must not be treated as a hydration failure"
);

assert.match(
  bridge,
  /if \(stateName\) nextState\[stateName\] = normalizeResourceRows\(resource, rows\);/,
  "hydration must replace local resource state even when the successful remote resource is empty"
);

assert.match(
  bridge,
  /if \(readError\) \{/,
  "failed remote reads must remain distinguishable from successful empty reads"
);

assert.match(
  bridge,
  /nextState\[stateName\] = normalizedRows;/,
  "cross-device sync must apply successful remote resource results"
);

console.log("Sprint 20 empty remote hydration contract: PASS");
