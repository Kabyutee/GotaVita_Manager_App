const fs = require("node:fs");
const assert = require("node:assert/strict");

const bridge = fs.readFileSync("js/core/order-write-boundary-bridge.js", "utf8");

assert.match(bridge, /let realtimeStartingChannel = null;/);
assert.match(bridge, /async function removeRealtimeChannel\(channel, client\)/);
assert.match(bridge, /await removeRealtimeChannel\(channel, client\)/);
assert.match(bridge, /function scheduleRealtimeRetry\(channel, client\)/);
assert.match(bridge, /scheduleRealtimeRetry\(channel, client\)/);
assert.match(bridge, /client\.channel\("gotavita-canonical-sync"\)/);
assert.equal((bridge.match(/client\.channel\("gotavita-canonical-sync"\)/g) || []).length, 1);

console.log("Sprint 23 Realtime channel lifecycle contract: PASS");
