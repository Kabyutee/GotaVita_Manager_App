const fs = require("node:fs");
const assert = require("node:assert/strict");

const syncManager = fs.readFileSync("js/core/sync-manager.js", "utf8");
const uiBridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");

assert.match(
  syncManager,
  /function bootstrap\(auth, current\)/,
  "Canonical startup hydration must be owned by GVSync"
);
assert.match(
  syncManager,
  /const remoteFirst = await fetchRemoteSet\(resources\)/,
  "Startup hydration must fetch a complete canonical remote snapshot"
);
assert.match(
  syncManager,
  /const canonicalResult = await fetchRemoteSet\(resources\)/,
  "Startup hydration must perform a canonical read-back"
);
assert.match(
  syncManager,
  /applyCanonicalSnapshot\(nextState, canonicalResult\.results\)/,
  "Startup hydration must commit the canonical remote snapshot through the state boundary"
);
assert.match(
  syncManager,
  /saveLocalSnapshot\(nextState\)/,
  "Successful hydration must persist the canonical local cache"
);
assert.match(
  syncManager,
  /if \(canonicalResult\.failures\.length\) throw new Error\(/,
  "Incomplete canonical hydration must fail closed rather than replacing state with a partial snapshot"
);

assert.match(uiBridge, /presentation boundary only/, "UI bridge must remain presentation-only");
assert.doesNotMatch(
  uiBridge,
  /function installSupabaseHydrationBoundary\(\)/,
  "Retired UI-owned Supabase hydration engine must not be present"
);
assert.doesNotMatch(
  uiBridge,
  /function syncCrossDevice\(original\)/,
  "Retired UI-owned cloud synchronization engine must not be present"
);

assert.match(indexHtml, /js\/core\/sync-manager\.js/, "sync-manager.js must be explicitly loaded by the application");
assert.match(indexHtml, /js\/core\/ui-bridge\.js/, "ui-bridge.js must remain explicitly loaded");

console.log("Phase 3 canonical hydration runtime contract: PASS");
