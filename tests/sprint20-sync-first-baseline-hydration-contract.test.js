const fs = require("fs");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/hydrateFirstBaseline/.test(source), "Canonical sync coordinator must own first-baseline hydration");
assert(/baseline\[resource\]/.test(source), "First-baseline hydration must be evaluated per resource");
assert(/!localRows\.length && remoteRows\.length/.test(source), "Only empty local resources may hydrate from a remote first baseline");
assert(/state\[stateName\]\s*=\s*remoteRows/.test(source), "Remote first-baseline rows must enter application state");
assert(!/if \(Object\.keys\(baseline\)\.length\) return false;/.test(source), "Global baseline presence must not suppress missing per-resource hydration");

console.log("Sprint 20 first-baseline hydration contract: PASS");
