const fs = require("node:fs");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/conflict-resolution-integration.js", "utf8");

assert.match(
  source,
  /if\(resourceCloudName\("orders"\) === "orders" && rawLocalRow && !rawRemoteRow\)/,
  "Order remote-gap guard must run whenever a local Order is missing remotely"
);
assert.match(
  source,
  /const remoteDeletion=deletionEvidence\(remoteDeletedRows,id\) \|\| deletionEvidence\(localDeletedRows,id\);/,
  "Order gap guard must check explicit deletion evidence"
);
assert.match(
  source,
  /if\(!remoteDeletion\)\s*\{\s*result=\{action:"keep-local",reason:"order-remote-missing-without-tombstone",mutation:true\};\s*\}/,
  "A missing remote Order without a tombstone must keep the local record"
);

console.log("Sprint 26 Order remote-gap protection contract: PASS");
