const fs = require("node:fs");
const assert = require("node:assert/strict");

const workflow = fs.readFileSync(
  ".github/workflows/production-drift-gate.yml",
  "utf8"
);

assert.match(
  workflow,
  /push:\s*[\s\S]*branches:\s*[\s\S]*- main/,
  "Production drift gate must run on pushes to main"
);
assert.match(
  workflow,
  /schedule:/,
  "Production drift gate must support scheduled verification"
);
assert.match(
  workflow,
  /workflow_dispatch:/,
  "Production drift gate must support manual verification"
);
assert.match(
  workflow,
  /gotavita-manager-app\.carleugenetolentino22\.workers\.dev/,
  "Production drift gate must target the live Worker"
);
assert.match(
  workflow,
  /git rev-parse HEAD/,
  "Expected production SHA must come from checked-out main"
);
assert.match(
  workflow,
  /deployed_sha.*EXPECTED_SHA/s,
  "Gate must compare deployed SHA against expected main SHA"
);
assert.match(
  workflow,
  /Production drift detected/,
  "Gate must fail explicitly on production drift"
);

console.log("Sprint 12 production drift gate contract: PASS");
