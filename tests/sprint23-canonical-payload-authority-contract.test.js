const fs = require("node:fs");
const assert = require("node:assert/strict");

const worker = fs.readFileSync("worker.js", "utf8");
assert.match(worker, /data-gateway\\\.js/);
assert.match(worker, /canonical Supabase columns win/);
assert.match(worker, /\.\.\.\(original && typeof original === \"object\" \? original : \{\}\)/);
assert.match(worker, /\.\.\.\(payload \|\| \{\}\)/);

console.log("Sprint 23 canonical payload authority contract: PASS");
