const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

assert.match(
  bridge,
  /const baseline = readBaseline\(\);/,
  "hydration must inspect the cloud baseline before deciding how to handle empty remote state"
);

assert.match(
  bridge,
  /if \(!baseline\?\.state && cloudIsCompletelyEmpty\) return \{ hydrated: false, reason: "cloud-empty" \};/,
  "first-run empty Supabase must preserve local or seed state"
);

assert.match(
  bridge,
  /if \(stateName\) nextState\[stateName\] = normalizeResourceRows\(resource, rows\);/,
  "hydration must replace a resource with the successful remote result, including an empty array"
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
