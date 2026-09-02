const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const indexPath = path.join(root, "index.html");
const index = fs.readFileSync(indexPath, "utf8");

function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".playwright-ci") continue;
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (/\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const source = collectFiles(root)
  .map((file) => fs.readFileSync(file, "utf8"))
  .map(stripJsComments)
  .join("\n");

const actionOccurrences = [];
const actionRe = /data-action="([^"]+)"/g;
let match;
while ((match = actionRe.exec(index))) {
  actionOccurrences.push({ action: match[1], index: match.index });
}

assert.ok(actionOccurrences.length > 0, "The application must declare data-action controls.");

const actions = new Set(actionOccurrences.map(({ action }) => action));

const missing = [...actions].filter((action) => {
  const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:async\\s+)?function\\s+${escaped}\\b`),
    new RegExp(`(?:window\\.)${escaped}\\s*=`),
    new RegExp(`(?:^|[,{;])\\s*${escaped}\\s*:\\s*(?:async\\s+)?function\\b`)
  ];
  return !patterns.some((pattern) => pattern.test(source));
});

assert.deepEqual(missing, [], `UI actions without an implementation: ${missing.join(", ")}`);

const argRe = /data-action-args=(?:"([^"]*)"|'([^']*)')/g;
const malformedArgs = [];
while ((match = argRe.exec(index))) {
  const raw = decodeHtmlEntities(match[1] ?? match[2] ?? "");
  try {
    JSON.parse(raw);
  } catch (error) {
    malformedArgs.push({ raw, error: error.message });
  }
}
assert.deepEqual(malformedArgs, [], `Malformed data-action-args: ${JSON.stringify(malformedArgs)}`);

// Guard against the double-stringified argument shape that breaks runtime dispatch.
const groupsRoutes = fs.readFileSync(path.join(root, "js/modules/groups-routes.js"), "utf8");
assert.doesNotMatch(
  groupsRoutes,
  /const\s+args\s*=\s*JSON\.stringify\(\[groupPickerOrderIds,\s*g\.name\]\)/,
  "Group Picker action arguments must remain an array before jsAttrArg encoding."
);
assert.match(
  groupsRoutes,
  /const\s+args\s*=\s*\[groupPickerOrderIds,\s*g\.name\]/,
  "Group Picker action arguments must be passed to jsAttrArg as an array."
);

const requiredHeaderControls = ["syncNow", "undoLastAction", "toggleDarkMode"];
for (const action of requiredHeaderControls) {
  assert.ok(actions.has(action), `Missing required header action declaration: ${action}`);
}

const requiredForms = [
  "orderForm",
  "orderEditForm",
  "expenseForm",
  "clientForm",
  "employeeForm"
];
for (const id of requiredForms) {
  assert.match(index, new RegExp(`id=["']${id}["']`), `Missing required business form: ${id}`);
}

console.log(`UI action wiring contract: PASS (${actions.size} actions, ${actionOccurrences.length} controls, action arguments validated)`);
