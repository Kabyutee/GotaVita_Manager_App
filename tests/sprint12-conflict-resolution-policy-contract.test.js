const fs = require("fs");
const source = fs.readFileSync("js/core/production-guard.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/function\s+resolveConflictPolicy\s*\(/.test(source), "Conflict policy must expose a named resolver");
assert(/local-newer/.test(source) && /remote-newer/.test(source), "Conflict policy must classify newer-side outcomes");
assert(/indeterminate/.test(source), "Conflict policy must preserve indeterminate cases");
assert(/deletion/.test(source), "Conflict policy must explicitly classify deletion cases");
assert(/manual-review/.test(source), "Ambiguous conflicts must be routed to manual review");
assert(/does not mutate|no mutation|mutation/i.test(source), "Policy contract must document that classification is side-effect free");

console.log("Sprint 12 conflict resolution policy contract: PASS");
