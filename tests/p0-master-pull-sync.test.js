const source = require('fs').readFileSync('js/core/sync-cloud-snapshot-safety.js','utf8');
function assert(condition, message) { if (!condition) throw new Error(message); }
assert(/P0_MASTER_RESOURCES/.test(source), 'P0 set must exist');
assert(/clients.*employees.*products/s.test(source), 'P0 resources must be clients/employees/products');
assert(/pullP0MasterData/.test(source), 'P0 read-only pull bridge must exist');
assert(/selectResource\(resource\)/.test(source), 'P0 pull must read remote resources');
assert(/updatedAt.*updated_at/s.test(source), 'P0 pull must compare canonical timestamps');
assert(!/deleteResourceByLegacyId/.test(source), 'P0 pull must never delete master data');
assert(!/upsertResource\(resource/.test(source), 'P0 pull must never write master data to cloud');
console.log('P0 master pull-sync contract: PASS');
