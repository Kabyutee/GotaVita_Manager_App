const fs = require("node:fs");
const assert = require("node:assert/strict");

const runs = fs.readFileSync("js/modules/daily-l300-runs.js", "utf8");
const state = fs.readFileSync("js/core/state.js", "utf8");
const audit = fs.readFileSync("tests/anti-big-bang-6-application-connection-audit.test.js", "utf8");

for (const id of ["masagana-alabang", "atc-alabang", "festival-alabang"]) assert.match(runs, new RegExp(id));
for (const windowName of ["Morning", "After Lunch", "Before Dinner"]) assert.match(runs, new RegExp(windowName));
assert.match(runs, /groupId/);
assert.match(runs, /state\.orderGroups/);
assert.match(runs, /groupForRun/);
assert.doesNotMatch(runs, /byExplicitRun/);
assert.match(runs, /openGroupManagerForDailyL300/);
assert.match(state, /dailyRuns:\[\]/);
assert.match(state, /loadDailyL300Module/);
assert.doesNotMatch(state, /loadL300ReportingAdapter/);
assert.doesNotMatch(state, /loadL300OperationsDashboard/);
assert.match(audit, /l300Presentation/);
assert.match(audit, /single-dashboard-panel/);
assert.match(audit, /l300Authority/);
assert.match(audit, /OrderGroups/);

console.log("L300 → Group Orders canonical single-panel contract: PASS");
