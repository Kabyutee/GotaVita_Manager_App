const fs = require("fs");

const source = fs.readFileSync(
  "js/modules/groups-routes.js",
  "utf8"
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /function newGroupLegacyId\(\)/.test(source),
  "Groups must have a dedicated stable legacy-ID generator"
);
assert(
  /ensureGroupLegacyIds\(\);/.test(source),
  "Legacy groups must be backfilled with stable IDs before sync"
);
assert(
  /state\.orderGroups\.push\(\{ id: newGroupLegacyId\(\), name, orderIds: \[\] \}\)/.test(source),
  "createGroup must assign a stable ID before persistState"
);
assert(
  /if \(!g\) \{ g = \{ id: newGroupLegacyId\(\), name: groupName, orderIds: \[\] \}; state\.orderGroups\.push\(g\); \}/.test(source),
  "Group creation through the order picker must assign a stable ID"
);

console.log("Sprint 20 group sync contract: PASS");
