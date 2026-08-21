const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("js/core/sync-status.js", "utf8");

assert.match(source, /setInterval\(kickSync, 5000\)/, "background sync watchdog must poll every 5 seconds");
assert.match(source, /window\.addEventListener\("focus", kickSync\)/, "focus must kick an immediate sync poll");
assert.match(source, /window\.addEventListener\("online", kickSync\)/, "online must kick an immediate sync poll");
assert.match(source, /document\.addEventListener\("visibilitychange"/, "visibility changes must kick an immediate sync poll");
assert.match(source, /window\.GVSync\.poll\(\)/, "watchdog must delegate to the authoritative GVSync poll");
assert.doesNotMatch(source, /renderAll\s*\(/, "watchdog must not own UI rendering");

console.log("Sprint 20 background sync kick contract: PASS");
