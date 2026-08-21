const fs = require("fs");

const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");
const guard = fs.readFileSync("js/core/production-guard.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /if \(!rawLocalRow && rawRemoteRow && !existedAtBaseline\)/.test(integration),
  "Remote-only baseline-absent records must be classified as new records"
);
assert(
  /result = \{ action: \"keep-remote\", reason: \"remote-new-record\"/.test(integration),
  "Remote-only new records must resolve automatically"
);
assert(
  /else if \(rawLocalRow && !rawRemoteRow && !existedAtBaseline\)/.test(integration),
  "Local-only baseline-absent records must be classified as new records"
);
assert(
  /result = \{ action: \"keep-local\", reason: \"local-new-record\"/.test(integration),
  "Local-only new records must resolve automatically"
);
assert(
  /isBaselinePlaceholder\(row, baseline\)/.test(guard),
  "Conflict policy must retain baseline-placeholder recognition"
);

console.log("Sprint 20 new-record convergence contract: PASS");
