const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync(
  "js/core/data-gateway.js",
  "utf8"
);
const bridge = fs.readFileSync(
  "js/core/ui-bridge.js",
  "utf8"
);

assert.match(
  gateway,
  /updated_at:/,
  "Supabase records must preserve updated_at metadata"
);
assert.match(
  gateway,
  /updatedAt:/,
  "Local records must hydrate updatedAt metadata"
);
assert.match(
  gateway,
  /legacy_payload:/,
  "Legacy payload must remain available for conflict reconstruction"
);
assert.match(
  bridge,
  /lastSynchronizedAt/,
  "Synchronization must record a reconciliation timestamp"
);
assert.match(
  bridge,
  /lastSynchronizedResources/,
  "Synchronization must record reconciled resources"
);

console.log(
  "Sprint 12 record versioning contract: PASS"
);
