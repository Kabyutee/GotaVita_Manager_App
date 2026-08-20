const fs = require("node:fs");
const assert = require("node:assert/strict");

const workflow = fs.readFileSync(
  ".github/workflows/anti-big-bang-risk-gate.yml",
  "utf8"
);

assert.match(workflow, /name: ANTI BIG BANG 3\.0 Risk Gate/);
assert.match(workflow, /pull_request:/);
assert.match(workflow, /git diff --name-only/);
assert.match(workflow, /risk="low"/);
assert.match(workflow, /risk="medium"/);
assert.match(workflow, /risk="high"/);
assert.match(workflow, /Production deployment: NOT performed/);
assert.doesNotMatch(workflow, /wrangler-action@v3/);

console.log("ANTI BIG BANG 3.0 runner contract: PASS");
