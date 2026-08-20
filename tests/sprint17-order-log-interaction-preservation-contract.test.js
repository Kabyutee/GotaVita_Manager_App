const fs = require("node:fs");
const assert = require("node:assert/strict");

const script = fs.readFileSync("script.js", "utf8");

assert.match(
  script,
  /function markOrderLogInteractionStart\(/,
  "Order Log must expose an interaction lease start helper"
);
assert.match(
  script,
  /function markOrderLogInteractionEnd\(/,
  "Order Log must expose an interaction lease end helper"
);
assert.match(
  script,
  /function isOrderLogInteractionActive\(/,
  "Order Log must expose an interaction-active guard"
);
assert.match(
  script,
  /if \(\s*isOrderLogInteractionActive\(\)\s*\) \{[\s\S]*?return false;/,
  "Background sync must defer while Order Log interaction is active"
);
assert.match(
  script,
  /\.order-checkbox|orderSearchInput|#panel-orderlog/,
  "The interaction guard must target Order Log controls"
);

console.log("Sprint 17 Order Log interaction preservation contract: PASS");
