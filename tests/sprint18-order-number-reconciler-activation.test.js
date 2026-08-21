const fs = require("fs");
const path = require("path");
const assert = require("assert");

const file = path.join(__dirname, "..", "js", "core", "sync-manager.js");
const text = fs.readFileSync(file, "utf8");

assert(
  text.includes("/js/core/sync-cloud-write-reconciler.js"),
  "sync manager must load the order-number reconciler"
);
assert(
  text.includes("await ensureOrderNumberReconciler();"),
  "sync manager must activate the reconciler before cloud sync"
);
assert(
  text.includes("__GV_ORDER_NUMBER_RECONCILER_READY"),
  "sync manager must avoid repeated reconciler loads"
);

console.log("sprint18 order-number reconciler activation contract: PASS");
