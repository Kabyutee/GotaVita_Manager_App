const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const uiBridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");

assert.match(gateway, /async function upsertResource\(\s*resource,\s*rows\s*\)/, "Write round-trip must use the gateway upsert boundary");
assert.match(gateway, /const auth =\s*await requireAuthenticatedManager\(\)/, "Write round-trip must remain behind manager authorization");
assert.match(gateway, /auth\.profile\.company_id/, "Write round-trip must remain company-scoped");
assert.match(gateway, /\.upsert\(\s*cloudRows/, "Write round-trip must reach the Supabase upsert boundary");
assert.match(gateway, /return fromSupabaseResource\(\s*name,\s*data\s*\);/, "Successful writes must return normalized read-back payload");
assert.match(uiBridge, /await original\.upsertResource\(cloudResourceName\(resource\), rows\);/, "Cross-device sync must push queued rows through the gateway using the resource alias");
assert.match(uiBridge, /window\.setSyncQueue\((?:\[\]|remainingQueued)\);/, "Successful synchronization must update the queue while preserving skipped resources");
assert.match(uiBridge, /status: \"sync-error\"/, "Failed synchronization must remain observable");

console.log("Sprint 12 write round-trip contract: PASS");
