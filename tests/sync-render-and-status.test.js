const fs = require("fs");
const path = require("path");
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(`SYNC RENDER/STATUS CONTRACT: ${message}`); }

const manager = read("js/core/sync-manager.js");
assert(/const affected = changed \|\| Boolean\(/.test(manager), "successful reconciliation must detect remote summary changes even when raw state digest is unchanged");
assert(/result\.summary\.keepRemote/.test(manager), "remote-merge summary must trigger render");
assert(/if \(affected \|\| manualReview\) renderRemoteState\(\);/.test(manager), "successful remote merges must render");
assert(/window\.setSyncStatus\(label, "online"\)/.test(manager), "successful sync must publish an explicit synced status");
assert(/window\.setSyncStatus\("Sync pending", "syncing"\)/.test(manager), "failed sync must retain pending status");

console.log("SYNC RENDER/STATUS CONTRACT: PASS");
