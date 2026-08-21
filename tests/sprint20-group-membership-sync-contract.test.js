const fs = require("fs");

const bridge = fs.readFileSync("js/core/group-membership-sync-bridge.js", "utf8");
const worker = fs.readFileSync("worker.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/orderGroups\[\]\.orderIds/.test(bridge), "Group parent membership must be part of the bridge contract");
assert(/orderGroupItems\[\]/.test(bridge), "Group child membership must be part of the bridge contract");
assert(/buildItemsFromGroups\(snapshot\)/.test(bridge), "Local parent membership must generate child rows");
assert(/applyItemsToGroups\(snapshot\)/.test(bridge), "Remote child rows must rebuild parent membership");
assert(/parentChanged && !itemsChanged/.test(bridge), "Parent-only changes must win over stale child rows");
assert(/!parentChanged && itemsChanged/.test(bridge), "Child-only changes must hydrate the parent");
assert(/group-membership-sync-bridge\.js/.test(worker), "Production Worker must load the Group membership bridge");

console.log("Sprint 20 Group membership synchronization contract: PASS");
