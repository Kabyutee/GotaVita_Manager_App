const fs = require("node:fs");
const assert = require("node:assert/strict");

const workflow = fs.readFileSync(".github/workflows/deploy-production.yml", "utf8");

assert.match(workflow, /concurrency:\s*\n\s*group:\s*gotavita-production/);
assert.match(workflow, /cancel-in-progress:\s*false/);
assert.match(workflow, /ref:\s*\$\{\{ github\.sha \}\}/);
assert.match(workflow, /EXPECTED_SHA:\s*\$\{\{ github\.sha \}\}/);
assert.match(workflow, /gv-health/);

console.log("Sprint 20 production deployment concurrency contract: PASS");
