const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const uiBridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

assert.match(
  gateway,
  /async function requireAuthenticatedManager\(\)/,
  "Write gateway must require the authenticated manager boundary"
);
assert.match(
  gateway,
  /result\.profile\.company_id/,
  "Write gateway must require company assignment"
);
assert.match(
  gateway,
  /auth\.profile\.company_id/,
  "Cloud writes must use the authenticated manager company_id"
);
assert.match(
  gateway,
  /CONFLICT_KEYS\s*=\s*Object\.freeze\(/,
  "Write gateway must define deterministic conflict keys"
);
assert.match(
  gateway,
  /onConflict:\s*conflictKey/,
  "Transactional upserts must use the configured conflict key"
);
assert.match(
  gateway,
  /onConflict:\s*\"company_id,legacy_id\"/,
  "Master-data upserts must be company-scoped"
);
assert.match(
  gateway,
  /if \(!payload\.length\) \{\s*return \[\];\s*\}/,
  "Empty writes must be no-ops"
);
assert.match(
  gateway,
  /if \(error\) \{\s*throw error;\s*\}/,
  "Supabase write failures must propagate instead of being treated as success"
);

assert.match(
  uiBridge,
  /return \{\s*ok: false,[\s\S]*status: \"sync-error\"/,
  "Cross-device write failures must remain visible to the state/sync layer"
);
assert.match(
  uiBridge,
  /window\.setSyncQueue\(/,
  "Failed writes must preserve the local synchronization queue"
);

console.log("Sprint 12 write safety contract: PASS");
