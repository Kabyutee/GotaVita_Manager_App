const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync("script.js", "utf8");
const stateFactory = fs.readFileSync("js/core/state.js", "utf8");

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".js")) files.push(full);
  }
  return files;
}

assert.equal(
  (script.match(/function replaceState\s*\(/g) || []).length,
  1,
  "replaceState must have exactly one authoritative implementation"
);
assert.equal(
  (script.match(/function getStateSnapshot\s*\(/g) || []).length,
  1,
  "getStateSnapshot must have exactly one authoritative implementation"
);

assert.match(
  script,
  /function replaceState[\s\S]*?state\s*=\s*nextState[\s\S]*?normalizeState\(\)/,
  "replaceState must remain the state replacement boundary"
);
assert.match(
  script,
  /function getStateSnapshot\s*\([\s\S]*?return clone\(state\)/,
  "getStateSnapshot must remain the authoritative snapshot boundary"
);

// Assignment checks must not confuse strict equality (===) with assignment (=).
const forbiddenModulePatterns = [
  /function\s+replaceState\s*\(/,
  /function\s+getStateSnapshot\s*\(/,
  /window\.replaceState\s*=(?!=)\s*/,
  /window\.getStateSnapshot\s*=(?!=)\s*/,
  /window\.state\s*=(?!=)\s*/,
  /window\.GV_STATE\s*=(?!=)\s*/
];

const moduleFiles = walk(path.join("js", "modules"));
for (const file of moduleFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenModulePatterns) {
    assert.ok(
      !pattern.test(source),
      `State ownership violation in ${file}: ${pattern}`
    );
  }
}

const coreFiles = walk(path.join("js", "core"))
  .filter((file) => !file.endsWith("state.js") && !file.endsWith("ui-bridge.js"));

for (const file of coreFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenModulePatterns) {
    assert.ok(
      !pattern.test(source),
      `State ownership violation in ${file}: ${pattern}`
    );
  }
}

assert.match(
  stateFactory,
  /window\.GV_STATE\s*=\s*Object\.freeze/,
  "Initial state construction must remain isolated behind GV_STATE"
);

console.log("Sprint 12 state ownership contract: PASS");
console.log(`Audited module files: ${moduleFiles.length}`);
console.log(`Audited non-bridge core files: ${coreFiles.length}`);
