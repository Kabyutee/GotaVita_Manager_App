const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const uiBridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

assert.match(gateway, /async function upsertResource\(\s*resource,\s*rows\s*\)/);
assert.match(gateway, /await requireAuthenticatedManager\(\)/);
assert.match(gateway, /auth\.profile\.company_id/);
assert.match(gateway, /\.upsert\(\s*cloudRows/);
assert.match(gateway, /return fromSupabaseResource\(\s*name,\s*data\s*\);/);
assert.match(uiBridge, /await original\.upsertResource\(cloudName, rows\);/);
assert.match(uiBridge, /window\.setSyncQueue\(\[\]\);/);
assert.match(uiBridge, /sync-error/);

console.log("Sprint 12 write round-trip contract: PASS");
