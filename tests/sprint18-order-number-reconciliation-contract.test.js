const fs = require("fs");
const path = require("path");
const assert = require("assert");

const file = path.join(__dirname, "..", "js", "core", "sync-cloud-write-reconciler.js");
const text = fs.readFileSync(file, "utf8");

assert(text.includes("const owner = ownerByOrderNumber.get(number);"), "reconciler must track order-number ownership");
assert(text.includes("used.has(number)"), "reconciler must track numbers already used by the current batch");
assert(text.includes("used.add(number);"), "reconciler must reserve a safe order number");
assert(text.includes("retryRows"), "reconciler must retry a concurrent unique conflict");
assert(text.includes("original.upsertResource(resource, retryRows)"), "reconciler must retry the complete reconciled batch");

console.log("sprint18 order-number reconciliation contract: PASS");
