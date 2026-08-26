const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/data-gateway.js", "utf8");
const start = source.indexOf("function mergePayload(");
assert.notEqual(start, -1, "mergePayload must exist");
const end = source.indexOf("\n  }", start);
assert.notEqual(end, -1, "mergePayload must be complete");
const block = source.slice(start, end + 4);

const legacy = block.indexOf("original &&");
const canonical = block.indexOf("...(payload || {})");
assert(legacy >= 0, "legacy payload fallback must remain supported");
assert(canonical > legacy, "canonical payload must be merged after legacy payload");

console.log("Sprint 23 canonical payload authority contract: PASS");
