const fs = require("fs");
const path = require("path");

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(`CANONICAL STARTUP AUTHORITY: ${message}`);
}

const syncManager = read("js/core/sync-manager.js");
const state = read("js/core/state.js");

assert(
  /gv-auth-state-changed[\s\S]*setTimeout\(\(\) => flush/.test(syncManager),
  "post-auth canonical flush must be deferred until the current auth/startup transaction returns"
);
assert(
  !/gv-auth-state-changed[\s\S]*scheduleAuthorizedHydration\(\)/.test(state),
  "state.js must not start a competing automatic post-auth hydration"
);
assert(
  /sole startup[\s\S]*GVSync\.flush\(\)/.test(state),
  "state.js must document GVSync as the sole startup synchronization authority"
);
assert(
  !/startPolling\(\); flush\(\)/.test(syncManager),
  "sync-manager must not synchronously flush from the auth lifecycle event"
);

console.log("CANONICAL STARTUP AUTHORITY: PASS");
