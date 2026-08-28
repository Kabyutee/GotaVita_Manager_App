const fs = require("node:fs");
const assert = require("node:assert/strict");

const read = (file) => fs.readFileSync(file, "utf8");
const exists = (file) => fs.existsSync(file);
const riskGate = read(".github/workflows/anti-big-bang-risk-gate.yml");
const preview = read(".github/workflows/anti-big-bang-preview.yml");
const integrity = read(".github/workflows/application-integrity-audit.yml");
const sync = read("js/core/sync-manager.js");
const uiActions = read("tests/ui-action-wiring-contract.test.js");

assert(riskGate.includes("JARVIS 9.0 business-first adaptive workflow"), "JARVIS 9 business workflow gate missing");
assert(riskGate.includes("JARVIS 7.0 adaptive whole-application scan"), "JARVIS 7 whole-application scan gate missing");
assert(riskGate.includes("JARVIS 8.0 runtime adaptation audit"), "JARVIS 8 runtime audit gate missing");
assert(riskGate.includes("JARVIS whole-app hardening contract"), "whole-app hardening gate missing");
assert(riskGate.includes("node tests/ui-action-wiring-contract.test.js"), "high-risk path must validate UI action wiring");
assert(riskGate.includes("node tests/canonical-sync-v2-simulation.test.js"), "high-risk path must run deterministic convergence simulation");
assert(riskGate.includes("node tests/canonical-sync-v2-bootstrap-safety.test.js"), "high-risk path must run first-run bootstrap safety simulation");
assert(riskGate.includes("Production deployment: NOT performed by this workflow"), "risk gate must never deploy production");
assert(riskGate.includes("concrete evidence"), "risk gate must retain evidence-first policy");

assert(preview.includes("Verify exact preview health"), "isolated preview must verify deployed release identity");
assert(preview.includes("Real Browser A/B convergence test"), "isolated preview must execute the real browser convergence test");
assert(preview.includes("production-cross-browser-sync.spec.js"), "isolated preview is not testing the canonical browser sync path");

assert(integrity.includes("node --check js/core/sync-manager.js"), "integrity gate must syntax-check canonical sync manager");
assert(integrity.includes("node --check js/core/ui-bridge.js"), "integrity gate must syntax-check UI bridge");
assert(!integrity.includes("node --check js/core/conflict-resolution-integration.js"), "retired conflict engine must not return to integrity checks");

assert(exists("tests/ui-action-wiring-contract.test.js"), "UI action contract file missing");
assert(uiActions.includes("requiredHeaderControls"), "UI action contract lost required header controls");
assert(exists("tests/canonical-sync-v2-bootstrap-safety.test.js"), "bootstrap safety simulation missing");
assert(sync.includes("capturePendingLocalMutations"), "canonical mutation capture missing");
assert(sync.includes("concurrentMutationDetected"), "concurrency protection missing");
assert(sync.includes("applyCanonicalSnapshot"), "canonical state commit missing");
assert(sync.includes("setMeta({ status: \\\"error\\\""), "sync error telemetry boundary missing");
assert(!sync.includes("Math.random()"), "synchronization identifiers must not use Math.random()");

console.log("JARVIS evidence-first operating contract: PASS");
console.log(JSON.stringify({
  fullApplicationAudit: true,
  uiActionWiring: true,
  deterministicSyncSimulation: true,
  firstRunBootstrapSafety: true,
  isolatedBrowserEvidence: true,
  releaseIdentityVerification: true,
  productionBlockedUntilEvidence: true,
  nondestructivePolicy: true,
  result: "PASS"
}, null, 2));
