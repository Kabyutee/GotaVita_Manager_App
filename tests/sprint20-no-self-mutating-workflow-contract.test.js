const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const workflowDir = path.join(process.cwd(), ".github", "workflows");
const files = fs.readdirSync(workflowDir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

for (const file of files) {
  const source = fs.readFileSync(path.join(workflowDir, file), "utf8");
  if (file === "anti-big-bang-risk-gate.yml") continue;

  assert.doesNotMatch(
    source,
    /permissions:\s*\n\s*contents:\s*write/,
    `${file} must not grant contents: write to pull-request automation`
  );

  if (/pull_request:/m.test(source)) {
    assert.doesNotMatch(
      source,
      /git\s+(commit|push)/,
      `${file} must not commit or push automatically from pull-request automation`
    );
  }
}

const removed = path.join(workflowDir, "anti-big-bang-queue-patch.yml");
assert.equal(fs.existsSync(removed), false, "legacy self-mutating queue patch workflow must remain removed");

console.log("Sprint 20 self-mutating workflow safety contract: PASS");
