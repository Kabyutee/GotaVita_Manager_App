const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync(
  ".github/workflows/production-drift-gate.yml",
  "utf8"
);

assert.doesNotMatch(source, /\n  push:\n    branches:\n      - main\n/);
assert.match(source, /\n  schedule:\n    - cron: "17 \* \* \* \*"\n/);
assert.match(source, /\n  workflow_dispatch:\n/);
assert.match(source, /ref: main/);
assert.match(source, /Production drift detected\./);
