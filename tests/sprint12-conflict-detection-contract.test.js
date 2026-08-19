const fs = require("fs");
const path = require("path");
const assert = require("assert");

const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "core", "production-guard.js"),
  "utf8"
);

assert.match(source, /window\.GVConflictDetector/);
assert.match(source, /function detect\(/);
assert.match(source, /lastUpdatedAt|updatedAt/);
assert.match(source, /baseline/);
assert.match(source, /localChanged/);
assert.match(source, /remoteChanged/);
assert.match(source, /conflicts/);
assert.match(source, /indeterminate/);
assert.match(source, /preferredObservation/);

// Detection-only rule: the detector must not silently select or overwrite a winner.
assert.doesNotMatch(source, /replaceState\([^)]*conflict/i);
assert.doesNotMatch(source, /setSyncQueue\(\[\]\).*conflict/i);

console.log("Sprint 12 conflict detection contract passed.");
