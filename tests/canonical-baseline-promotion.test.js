const fs = require("fs");
const path = require("path");
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(`CANONICAL BASELINE PROMOTION: ${message}`); }

const bridge = read("js/core/canonical-preservation-bridge.js");
const status = read("js/core/sync-status.js");
const integration = read("js/core/conflict-resolution-integration.js");

assert(bridge.includes("buildResolutionPlan"), "bridge must reuse the canonical resolution planner");
assert(/decision\.action\s*!==\s*\"preserve-local\"/.test(bridge), "bridge must only promote rows already classified preserve-local");
assert(/upsertResource\s*\(/.test(bridge), "bridge must promote preserved rows through the canonical data gateway");
assert(!bridge.includes("deleteResourceByLegacyId"), "bridge must never delete remote rows");
assert(bridge.includes('resource === "auditLog" || resource === "audit_logs"'), "bridge must exclude audit history from canonical promotion");
assert(status.includes("canonical-preservation-bridge.js"), "status boundary must load the preservation bridge");
assert(status.includes("?v=${Date.now()}"), "preservation bridge must be cache-busted for stale browser protection");
assert(/preserve-local[\s\S]*remote-row-missing-without-deletion-evidence/.test(integration), "canonical integration must retain preserve-local decision semantics");

const promotePos = bridge.indexOf("await promotePreservedRows()");
const canonicalRunPos = bridge.indexOf("await window.GVConflictIntegration.run(true)");
assert(promotePos !== -1 && canonicalRunPos !== -1 && promotePos < canonicalRunPos, "baseline promotion must occur before canonical pull");

console.log("CANONICAL BASELINE PROMOTION: PASS");
