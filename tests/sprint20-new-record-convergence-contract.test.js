const fs = require("fs");

const source = fs.readFileSync("js/core/production-guard.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /function isBaselinePlaceholder\(row, baseline\)/.test(source),
  "Conflict policy must recognize synthetic baseline placeholders"
);
assert(
  /remote-new-record-against-baseline/.test(source),
  "Remote-only new records must resolve automatically"
);
assert(
  /local-new-record-against-baseline/.test(source),
  "Local-only new records must resolve automatically"
);
assert(
  /isBaselinePlaceholder\(remoteRow, baseline\)[\s\S]*keep-local/.test(source),
  "Local new-record resolution must precede timestamp indeterminate fallback"
);
assert(
  /isBaselinePlaceholder\(localRow, baseline\)[\s\S]*keep-remote/.test(source),
  "Remote new-record resolution must precede timestamp indeterminate fallback"
);

console.log("Sprint 20 new-record convergence contract: PASS");
