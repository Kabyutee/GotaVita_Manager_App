const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/modules/groups-routes.js", "utf8");

// The Edit Order group control is intentionally created at runtime so the
// existing index.html/modal markup stays untouched.
assert.match(source, /createElement\("select"\)/);
assert.match(source, /editOrderGroup/);
assert.match(source, /-- No Group --/);
assert.match(source, /groupBefore/);
assert.match(source, /groupAfter/);
assert.match(source, /state\.orderGroups\.forEach\(\(g\) =>/);
assert.match(source, /saveStateForUndo\(\)/);
assert.match(source, /persistState\(\);/);
assert.match(source, /renderAll\(\);/);

console.log("Sprint 14 order-edit group contract: PASS");
