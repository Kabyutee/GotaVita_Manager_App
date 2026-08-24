const source = require('fs').readFileSync('js/core/sync-cloud-snapshot-safety.js', 'utf8');
function assert(condition, message) { if (!condition) throw new Error(message); }
assert(/P0_MASTER_RESOURCES/.test(source), 'P0 set must exist');
assert(/hasPendingLocalP0Write/.test(source), 'pending local P0 write guard must exist');
assert(/remote.*canonical|canonical.*master row/s.test(source), 'remote canonical rule must be documented');
assert(/if \(protectLocalEdits\) continue/.test(source), 'pending local write must block passive overwrite');
assert(/replaceState\(current\)/.test(source), 'receiving browser must replace authoritative state');
assert(/writeLocalStateSnapshot\(current\)/.test(source), 'receiving browser must persist the pulled state');
assert(/never infer P0 deletions/i.test(source), 'P0 deletion safety must remain');
console.log('P0 canonical pull contract: PASS');
