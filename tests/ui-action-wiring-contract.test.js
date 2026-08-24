const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (/\.(js|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const source = collectFiles(root).map((file) => fs.readFileSync(file, "utf8")).join("\n");
const actions = new Set();
const actionRe = /data-action="([^"]+)"/g;
let match;
while ((match = actionRe.exec(index))) actions.add(match[1]);

assert.ok(actions.size > 0, "The application must declare data-action controls.");

const missing = [...actions].filter((action) => {
  const patterns = [
    new RegExp(`(?:async\\s+)?function\\s+${action}\\b`),
    new RegExp(`(?:window\\.)${action}\\s*=`),
    new RegExp(`(?:^|[,{])\\s*${action}\\s*:\\s*(?:async\\s+)?function\\b`)
  ];
  return !patterns.some((pattern) => pattern.test(source));
});

assert.deepEqual(missing, [], `UI actions without an implementation: ${missing.join(", ")}`);

const requiredHeaderControls = ["syncNow", "undoLastAction", "toggleDarkMode"];
for (const action of requiredHeaderControls) assert.ok(actions.has(action), `Missing required header action declaration: ${action}`);

console.log(`UI action wiring contract: PASS (${actions.size} actions checked)`);
