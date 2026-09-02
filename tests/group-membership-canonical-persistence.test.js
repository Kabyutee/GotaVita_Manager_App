const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const groups = fs.readFileSync(path.join(root, "js/modules/groups-routes.js"), "utf8");
const finalizer = fs.readFileSync(path.join(root, "js/core/canonical-runtime-alias-finalizer.js"), "utf8");

assert.match(groups, /function saveGroupManager\s*\(/, "Group manager save handler must exist.");
assert.match(groups, /function assignOrdersToGroup\s*\(/, "Group assignment handler must exist.");
assert.match(groups, /function removeOrderFromGroup\s*\(/, "Single-order group removal handler must exist.");
assert.match(groups, /function removeSelectedFromGroup\s*\(/, "Selected-order group removal handler must exist.");
assert.match(groups, /editOrderGroup/, "Existing-order group editing must expose a delivery-group selector.");
assert.ok(groups.includes("const args = [groupPickerOrderIds, g.name];"), "Group picker arguments must remain an array before attribute encoding.");
assert.ok(groups.includes("data-action-args='${jsAttrArg(args)}'"), "Group picker arguments must use the shared JSON-safe attribute encoder.");

assert.match(finalizer, /function reconcileGroupMembershipForPersistence\s*\(/, "Canonical persistence must reconcile derived group membership.");
assert.match(finalizer, /orderGroupItems/, "Canonical persistence guard must operate on order_group_items state.");
assert.match(finalizer, /window\.persistState\s*=\s*guardedPersistState/, "Canonical persistence guard must wrap persistState.");
assert.match(finalizer, /groupLegacyId/, "Group membership rows must preserve group legacy identity.");
assert.match(finalizer, /orderLegacyId/, "Group membership rows must preserve order legacy identity.");

console.log("Group membership canonical persistence contract: PASS");
