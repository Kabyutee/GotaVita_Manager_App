const source = require('fs').readFileSync('js/core/sync-cloud-snapshot-safety.js','utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/P0_MASTER_RESOURCES/.test(source), 'P0 resource set must exist');
assert(/new Set\(\["clients", "employees", "products"\]\)/.test(source), 'P0 set must contain clients, employees, products');
assert(/P0_MASTER_RESOURCES\.has\(resource\)/.test(source), 'P0 resources must use dedicated safety logic');
assert(/P0 master data is never inferred-deleted by passive sync/i.test(source), 'P0 passive-sync rule must be documented');
assert(/confirm !== true/.test(source), 'Cloud recovery must remain explicitly confirmed');
console.log('P0 master-data safety contract: PASS');
