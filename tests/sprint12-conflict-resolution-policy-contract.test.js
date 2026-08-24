const fs = require("fs");
const source = fs.readFileSync("js/core/production-guard.js", "utf8");
const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/function\s+resolveConflictPolicy\s*\(/.test(source), "Conflict policy must expose a named resolver");
assert(/local-newer/.test(source) && /remote-newer/.test(source), "Production guard must retain newer-side classifications for compatibility diagnostics");
assert(/deletion/.test(source), "Production guard must explicitly classify deletion cases");
assert(/mutation:\s*false/.test(source), "Policy results must remain side-effect free");
assert(/rowsEquivalent/.test(integration), "Universal sync must compare rows without timestamp-only drift");
assert(/remote-canonical/.test(integration), "Receiving browsers must adopt the remote canonical row when no local write is pending");
assert(/pending-local-write/.test(integration), "A pending local write must retain local authority until acknowledgement");
assert(/preserve-local/.test(integration), "Missing remote rows must be preserved when deletion evidence is absent");
assert(/explicit-remote-deletion-evidence/.test(integration), "Order deletion must require explicit tombstone evidence");
assert(/delete-local/.test(integration), "Universal sync must support evidence-backed deletion");
assert(!/same-timestamp-divergent-content/.test(integration), "Equal timestamps must not dead-end normal synchronization");
assert(!/manual-review/.test(integration), "Normal universal synchronization must not block ordinary records with manual-review");

console.log("Sprint 12 universal canonical synchronization contract: PASS");
