const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('js/core/conflict-resolution-integration.js', 'utf8');

assert(source.includes('stateConcurrencyDigest'), 'sync concurrency digest guard must exist');
assert(source.includes('concurrent local mutation detected'), 'sync must detect concurrent local mutations');
assert(source.includes('retryDepth'), 'sync must bound concurrency retries');
assert(source.includes('return await run(force,retryDepth+1)'), 'sync must retry at most once after concurrent mutation');
assert(source.includes('preserving newest local state'), 'sync must preserve newest local state when the race persists');

console.log('Sprint 21 sync concurrency contract: PASS');
