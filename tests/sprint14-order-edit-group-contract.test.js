const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/modules/groups-routes.js", "utf8");

assert.match(source, /id=\\\"editOrderGroup\\\"/);
assert.match(source, /-- No Group --/);
assert.match(source, /groupBefore/);
assert.match(source, /groupAfter/);
assert.match(source, /state\.orderGroups\.forEach\(\(g\) =>/);
assert.match(source, /saveStateForUndo\(\)/);
assert.match(source, /persistState\(\);/);
assert.match(source, /renderAll\(\);/);

console.log("Sprint 14 order-edit group contract: PASS");
