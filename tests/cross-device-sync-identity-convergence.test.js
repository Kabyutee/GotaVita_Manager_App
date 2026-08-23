const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "js", "core", "conflict-resolution-integration.js");
const source = fs.readFileSync(file, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function stableRowId(row)"), "Stable cross-device identity helper is missing.");
assert(source.indexOf("row?.legacy_id") < source.indexOf("window.GVConflictDetector?.rowKey"), "Legacy identity must be resolved before detector identity.");
assert(source.includes("if (row?.id != null && String(row.id).trim() !== \"\")"), "Local id fallback is missing.");
assert(source.includes("remote-new-record"), "Remote-only records must remain an explicit reconciliation decision.");
assert(source.includes("nextState[stateName] = rows"), "Remote reconciliation must update application state.");

console.log("cross-device sync identity convergence contract: PASS");
