const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

assert.match(
  bridge,
  /return \{ hydrated: true, renderRequired: true, counts:/,
  "successful initial Supabase hydration must explicitly require a render"
);

assert.match(
  bridge,
  /const hydration = await hydrateFromSupabase\(original\);/,
  "health boundary must consume the initial hydration result"
);

assert.match(
  bridge,
  /if \(hydration\?\.renderRequired && window\.GVUI\?\.renderAll\) \{\s*window\.GVUI\.renderAll\(\);\s*\}/,
  "initial hydration must trigger the UI render through the canonical GVUI boundary"
);

assert.match(
  bridge,
  /if \(!Object\.values\(cloudRows\)\.some\(\(rows\) => rows\.length > 0\)\) return \{ hydrated: false, reason: "cloud-empty" \};/,
  "existing seed-safe empty-cloud behavior must remain intact"
);

console.log("Sprint 20 initial hydration render contract: PASS");
