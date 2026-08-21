const fs = require("fs");

const bridge = fs.readFileSync("js/core/group-membership-sync-bridge.js", "utf8");
const integration = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");
const syncManager = fs.readFileSync("js/core/sync-manager.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/function reconcileCurrentState\(\)/.test(bridge), "Group bridge must expose an explicit current-state reconciliation hook");
assert(/function reconcileRemoteState\(snapshot\)/.test(bridge), "Group bridge must expose a remote-hydration reconciliation hook");
assert(/parentChanged && itemsChanged && !membershipEquivalent\(snapshot\)/.test(bridge), "Both-sides remote changes must converge through the parent membership invariant");
assert(!/window\.persistState\s*=\s*function/.test(bridge), "Group bridge must not wrap canonical persistState");
assert(/GVGroupMembershipBridge\?\.reconcileCurrentState/.test(syncManager), "Canonical sync coordinator must reconcile local Group membership before conflict resolution");
assert(/GVGroupMembershipBridge\?\.reconcileRemoteState/.test(integration), "Canonical conflict integration must invoke Group remote reconciliation");
assert(/replaceState\(nextState\)/.test(integration), "Reconciled Group state must be published through canonical state replacement");
assert(/renderRemoteState\(\)/.test(syncManager), "Canonical sync manager must render reconciled remote state");

console.log("Sprint 20 Group remote membership reconciliation contract: PASS");
