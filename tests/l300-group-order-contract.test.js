const fs = require("node:fs");
const assert = require("node:assert/strict");

const runs = fs.readFileSync("js/modules/daily-l300-runs.js", "utf8");
const dashboard = fs.readFileSync("js/modules/l300-operations-dashboard.js", "utf8");
const reporting = fs.readFileSync("js/modules/l300-reporting-adapter.js", "utf8");
const state = fs.readFileSync("js/core/state.js", "utf8");

for (const id of ["masagana-alabang", "atc-alabang", "festival-alabang"]) assert.match(runs, new RegExp(id));
for (const windowName of ["Morning", "After Lunch", "Before Dinner"]) assert.match(runs, new RegExp(windowName));
assert.match(runs, /groupId/);
assert.match(runs, /state\.orderGroups/);
assert.match(runs, /groupForRun/);
assert.doesNotMatch(runs, /byExplicitRun/);
assert.match(runs, /openGroupManagerForDailyL300/);
assert.match(dashboard, /Group Orders/);
assert.match(reporting, /GV_DAILY_L300/);
assert.match(state, /dailyRuns:\[\]/);

console.log("L300 → Group Orders contract: PASS");
