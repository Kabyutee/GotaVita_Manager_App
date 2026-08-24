const fs = require("fs");
const source = fs.readFileSync("js/core/production-guard.js", "utf8");
const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/function\s+resolveConflictPolicy\s*\(/.test(source), "Conflict policy must expose a named resolver");
assert(/local-newer/.test(source) && /remote-newer/.test(source), "Conflict policy must classify newer-side outcomes");
assert(/indeterminate/.test(source), "Conflict policy must preserve indeterminate cases");
assert(/deletion/.test(source), "Conflict policy must explicitly classify deletion cases");
assert(/manual-review/.test(source), "Ambiguous conflicts must be routed to manual review");
assert(/mutation:\s*false/.test(source), "Policy results must be side-effect free");
assert(/does not\s+mutate|no automatic resolver|side-effect-free/i.test(source), "Policy contract must document non-mutating behavior");
assert(/rowsEquivalent/.test(source) && /equivalent-records/.test(source), "Equivalent legacy rows must not be promoted to manual review");
assert(/function\s+rowsEquivalent\s*\(/.test(integration), "Integration must compare rows without timestamp-only drift");
assert(/both-match-baseline/.test(integration), "Baseline-equivalent rows must converge without manual review");
assert(/remote-only-change-by-baseline/.test(integration), "Remote-only baseline changes must converge without timestamps");
assert(/local-only-change-by-baseline/.test(integration), "Local-only baseline changes must converge without timestamps");

console.log("Sprint 12 conflict resolution policy contract: PASS");
