const fs = require('fs');
const assert = require('assert');

const workflow = fs.readFileSync('.github/workflows/anti-big-bang-risk-gate.yml', 'utf8');

assert(workflow.includes('full_audit=false'), 'risk classifier must default full_audit to false');
assert(workflow.includes('*)\n                full_audit=true'), 'unclassified paths must trigger a full audit');
assert(workflow.includes('echo "full_audit=$full_audit"'), 'full_audit output must reflect the classifier result');
assert(!workflow.includes('full_audit=true\n\n          for file'), 'classifier must not hard-code full_audit=true before evaluating files');
assert(!workflow.includes('echo "full_audit=true"'), 'classifier must not publish a hard-coded full_audit=true value');

console.log('ANTI BIG BANG adaptive risk classifier contract: PASS');
