const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync(".github/workflows/anti-big-bang-risk-gate.yml", "utf8");

assert.match(source, /types:\s*\[opened, synchronize, reopened\]/, "ready_for_review must not trigger a duplicate required gate");
assert.match(source, /Focused sync polling gate/, "sync changes must retain the focused live-sync contract");
assert.match(source, /Workflow safety gate/, "workflow changes must retain a dedicated safety gate");
assert.match(source, /Production deployment: NOT performed by this workflow/, "risk gate must never deploy production");
assert.match(source, /ANTI BIG BANG 5\.0/, "optimized gate version marker missing");

console.log("ANTI BIG BANG 5.0 optimization contract: PASS");
