const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync(
  "js/core/sync-cloud-snapshot-safety.js",
  "utf8"
);

const context = {
  console,
  setTimeout,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  window: {
    addEventListener() {},
    getStateSnapshot() { return {}; },
    GVData: { supportedResources: () => [] }
  }
};

vm.createContext(context);
vm.runInContext(source, context);

const guard = context.window.GVCloudSnapshotSafety;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const local64 = Array.from({ length: 64 }, (_, i) => ({ id: `c${i}` }));
const remote2 = [{ id: "c0" }, { id: "c1" }];
assert(guard.unsafeShrink(local64, remote2, "clients", []) === true, "64 local vs 2 remote must block");
assert(guard.unsafeShrink(local64, [], "clients", []) === true, "64 local vs 0 remote must block");

const local11 = Array.from({ length: 11 }, (_, i) => ({ id: `o${i}` }));
assert(guard.unsafeShrink(local11, [], "orders", []) === true, "11 local vs 0 remote orders must block without deletion evidence");
assert(guard.unsafeShrink(local11, [], "orders", local11.map((row) => ({ id: row.id }))) === false, "Order shrink is allowed when every missing order has tombstone evidence");

assert(guard.unsafeShrink([], [], "clients", []) === false, "Empty local state must not be blocked");
assert(guard.unsafeShrink(local64, local64, "clients", []) === false, "Equal-size snapshots are safe");

console.log("Cloud snapshot safety gate contract: PASS");
