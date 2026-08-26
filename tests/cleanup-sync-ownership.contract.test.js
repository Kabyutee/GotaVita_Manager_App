const fs = require('node:fs');
const assert = require('node:assert/strict');

const syncManager = fs.readFileSync('js/core/sync-manager.js', 'utf8');
const gateway = fs.readFileSync('js/core/data-gateway.js', 'utf8');
const orderBridge = fs.readFileSync('js/core/order-write-boundary-bridge.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert.match(syncManager, /window\.GVSync\s*=\s*Object\.freeze/);
assert.match(gateway, /async function selectResource/);
assert.match(gateway, /async function upsertResource/);
assert.match(orderBridge, /function startRealtime/);
assert.match(orderBridge, /channel\.on\(/);
assert.match(orderBridge, /channel\.subscribe\(/);
assert.doesNotMatch(index, /recent-order-state-protection/);
assert.doesNotMatch(index, /realtime-channel-lifecycle-fix/);

console.log('Canonical sync ownership cleanup contract: PASS');
