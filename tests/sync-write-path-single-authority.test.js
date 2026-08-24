const fs = require("fs");
const path = require("path");
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(`SYNC WRITE PATH CONTRACT: ${message}`); }

const manager = read("js/core/sync-manager.js");
const integration = read("js/core/conflict-resolution-integration.js");

assert(/window\.syncChangedResources\s*=\s*\(\)\s*=>\s*window\.GVSync\.flush\(\)/.test(manager), "sync-manager must own the public syncChangedResources entry point");
assert(/window\.syncNow\s*=\s*\(\)\s*=>\s*window\.GVSync\.flush\(\)/.test(manager), "sync-manager must own the public syncNow entry point");
assert(/window\.GVData\.upsertResource\(cloudName, \[decision\.local\]\)/.test(integration), "canonical integration must write pending local rows through GVData");

console.log("SYNC WRITE PATH CONTRACT: PASS");
