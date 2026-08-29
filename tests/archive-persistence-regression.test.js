const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const orders = fs.readFileSync(path.join(root, "js/modules/orders.js"), "utf8");

const match = orders.match(/function\s+archiveOrders\s*\([\s\S]*?\n}\n/);
assert.ok(match, "archiveOrders function must exist");

const source = match[0];
assert.match(source, /state\.deletedOrders\.push/);
assert.match(source, /state\.orders\s*=\s*state\.orders\.filter/);
assert.match(source, /persistState\s*\(/, "archiveOrders must persist the archive mutation");
assert.match(source, /renderAll\s*\(|renderPartial\s*\(/, "archiveOrders must refresh the affected UI after mutation");

console.log("Order archive persistence regression contract: PASS");
