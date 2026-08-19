const fs = require("node:fs");
const assert = require("node:assert/strict");

const html = fs.readFileSync("index.html", "utf8");
const state = fs.readFileSync("js/core/state.js", "utf8");
const gateway = fs.readFileSync("js/core/data-gateway.js", "utf8");
const uiBridge = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const script = fs.readFileSync("script.js", "utf8");

function scriptOrder(source) {
  return [...source.matchAll(/<script\s+src=["']([^"']+)["'][^>]*><\/script>/gi)]
    .map((match) => match[1]);
}

const scripts = scriptOrder(html);
const uiIndex = scripts.indexOf("js/core/ui-bridge.js");
const appIndex = scripts.indexOf("script.js");
const gatewayIndex = scripts.indexOf("js/core/data-gateway.js");
const authIndex = scripts.indexOf("js/core/auth.js");

assert.ok(uiIndex >= 0, "ui-bridge.js must be loaded by index.html");
assert.ok(appIndex >= 0, "script.js must be loaded by index.html");
assert.ok(gatewayIndex >= 0, "data-gateway.js must be loaded by index.html");
assert.ok(authIndex >= 0, "auth.js must be loaded by index.html");
assert.ok(authIndex < gatewayIndex, "auth.js must load before data-gateway.js");
assert.ok(gatewayIndex < uiIndex, "data-gateway.js must load before ui-bridge.js");
assert.ok(uiIndex < appIndex, "ui-bridge.js must load before script.js");

assert.match(html, /document\.documentElement\.dataset\.gvAuthState\s*=\s*["']locked["']/);
assert.match(html, /id=["']gvCloudLoginBtn["']/);
assert.match(html, /id=["']gvCloudLogoutBtn["'][^>]*hidden/);
assert.match(script, /if \(!authorized\)/);
assert.match(script, /replaceState\(\s*window\.GV_STATE\.createInitialState\(\)/);
assert.match(uiBridge, /window\.GVData\s*=\s*Object\.freeze\(facade\)/);
assert.match(uiBridge, /sync: async function wrappedSync/);
assert.match(gateway, /async function sync\(\)/);
assert.match(state, /window\.GV_STATE\s*=\s*Object\.freeze/);

console.log("Sprint 11 release-readiness verification: PASS");
console.log(`Verified script ordering: auth(${authIndex}) < gateway(${gatewayIndex}) < ui-bridge(${uiIndex}) < app(${appIndex})`);
