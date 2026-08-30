const fs = require("node:fs");
const assert = require("node:assert/strict");

const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const finalizer = fs.readFileSync("js/core/canonical-runtime-alias-finalizer.js", "utf8");
const script = fs.readFileSync("script.js", "utf8");

assert.match(script, /function\s+getStateSnapshot\s*\(/, "script.js must expose the canonical state snapshot boundary");
assert.match(gateway, /function\s+getState\s*\(\)\s*\{[\s\S]*?window\.state[\s\S]*?\?\s*window\.state[\s\S]*?\}/, "GVData.getState compatibility method must remain available");
assert.match(finalizer, /Object\.defineProperty\(window,\s*"state"[\s\S]*?get:\s*\(\)\s*=>[\s\S]*?window\.getStateSnapshot\(\)/, "window.state must be a canonical snapshot-backed getter");
assert.match(finalizer, /configurable:\s*true/, "window.state compatibility property must remain safely replaceable");
assert.doesNotMatch(finalizer, /window\.state\s*=\s*[^=]/, "finalizer must not create a second mutable state assignment");

console.log("GVData state boundary contract: PASS");
