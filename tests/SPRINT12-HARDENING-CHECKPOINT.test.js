const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("js/core/ui-bridge.js", "utf8");
assert.match(source, /A transient cloud failure must not permanently poison the one-shot/);
assert.match(source, /hydrationPromise = null/);
console.log("Sprint 12 hardening source checkpoint: PASS");
