const fs = require("fs");

function read(path) { return fs.readFileSync(path, "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(`JARVIS whole-app hardening: ${message}`); }

const syncManager = read("js/core/sync-manager.js");
const conflictIntegration = read("js/core/conflict-resolution-integration.js");
const worker = read("worker.js");
const wrangler = read("wrangler.jsonc");

assert(syncManager.includes("function createQueueId()"), "queue ID helper missing");
assert(syncManager.includes("crypto?.randomUUID") || syncManager.includes("crypto.randomUUID"), "queue IDs do not prefer Web Crypto");
assert(syncManager.includes("crypto?.getRandomValues") || syncManager.includes("crypto.getRandomValues"), "queue IDs lack a Web Crypto fallback");
assert(!syncManager.includes("Math.random()"), "non-cryptographic Math.random() remains in synchronization queue identity");

const logoutSection = syncManager.match(/window\.addEventListener\("gv-auth-state-changed"[\s\S]*?\n\s*\}\);/);
assert(logoutSection, "auth lifecycle handler missing");
assert(!/else\s*\{[\s\S]*?clearQueue\(\)/.test(logoutSection[0]), "sign-out path clears queued work");
assert(logoutSection[0].includes("stopPolling()"), "sign-out path does not stop polling");

assert(/(?:const|let|var)\s+result\s*=\s*await\s+reconcileResource\s*\(/.test(conflictIntegration), "universal reconciliation path missing");
assert(!conflictIntegration.includes("same-timestamp-divergent-content"), "equal-timestamp records still dead-end in manual review");
assert(conflictIntegration.includes("remote-canonical"), "remote canonical row resolution missing");
assert(conflictIntegration.includes("pending-local-create-or-update"), "pending local create/update resolution missing");
assert(conflictIntegration.includes("preserve-local"), "protected local-only record resolution missing");
assert(conflictIntegration.includes("explicit-remote-deletion-evidence"), "remote Order deletion evidence missing");
assert(conflictIntegration.includes("explicit-local-deletion-evidence"), "local Order deletion evidence missing");
assert(conflictIntegration.includes("window.replaceState(nextState)"), "reconciled state is not committed back to application state");

assert(worker.includes('url.pathname === "/gv-health"'), "health endpoint missing");
assert(worker.includes('url.pathname === "/gv-config"'), "config endpoint missing");
assert(worker.includes("LEGACY_API_RETIRED"), "retired API boundary is not explicit");
assert(wrangler.includes('"observability"'), "Workers observability is not configured");
assert(wrangler.includes('"compatibility_date"'), "Workers compatibility date is missing");

console.log("JARVIS WHOLE-APP HARDENING CONTRACT: PASS");
console.log(JSON.stringify({
  synchronizationQueueProtection: true,
  universalCanonicalSynchronization: true,
  twoWayOrderDeletionEvidence: true,
  workerBoundaries: true,
  workersConfiguration: true,
  result: "PASS"
}, null, 2));
