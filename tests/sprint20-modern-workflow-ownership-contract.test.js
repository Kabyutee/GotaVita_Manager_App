const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const workflows = path.join(process.cwd(), ".github", "workflows");

const riskGate = fs.readFileSync(path.join(workflows, "anti-big-bang-risk-gate.yml"), "utf8");
const preview = fs.readFileSync(path.join(workflows, "anti-big-bang-preview.yml"), "utf8");
const production = fs.readFileSync(path.join(workflows, "deploy-production.yml"), "utf8");
const drift = fs.readFileSync(path.join(workflows, "production-drift-gate.yml"), "utf8");

assert.match(riskGate, /ANTI BIG BANG 5\.0/);
assert.match(riskGate, /Production deployment: NOT performed by this workflow/);
assert.match(preview, /candidate_sha/);
assert.match(preview, /gv-health/);
assert.match(production, /branches:\s*\n\s*- main/);
assert.match(production, /EXPECTED_SHA/);
assert.match(production, /gv-health/);
assert.match(drift, /schedule:/);
assert.match(drift, /Production drift detected/);

for (const legacy of ["phase1-state-bridge.yml", "deploy-pr40-preview.yml"]) {
  assert.equal(
    fs.existsSync(path.join(workflows, legacy)),
    false,
    `${legacy} must remain retired from the active workflow set`
  );
}

console.log("Sprint 20 modern workflow ownership contract: PASS");
