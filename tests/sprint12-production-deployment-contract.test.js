const fs = require("node:fs");
const assert = require("node:assert/strict");

const workflow = fs.readFileSync(
  ".github/workflows/deploy-production.yml",
  "utf8"
);
const worker = fs.readFileSync("worker.js", "utf8");

assert.match(
  workflow,
  /branches:\s*[\r\n\s-]*main/,
  "Production deployment must trigger from main"
);
assert.match(
  workflow,
  /cloudflare\/wrangler-action@v3/,
  "Production deployment must use Wrangler"
);
assert.match(
  workflow,
  /CLOUDFLARE_API_TOKEN/,
  "Cloudflare API token secret is required"
);
assert.match(
  workflow,
  /CLOUDFLARE_ACCOUNT_ID/,
  "Cloudflare account ID secret is required"
);
assert.match(
  workflow,
  /GV_RELEASE_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
  "Deployment must publish the exact Git commit SHA"
);
assert.match(
  workflow,
  /gotavita-manager-app\.carleugenetolentino22\.workers\.dev\/gv-health/,
  "Deployment verification must target the production Worker"
);
assert.match(
  worker,
  /releaseSha:\s*String\(env\.GV_RELEASE_SHA/,
  "Production health endpoint must expose the deployed release SHA"
);

console.log("Sprint 12 production deployment bridge contract: PASS");
