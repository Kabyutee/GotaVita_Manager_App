const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-queue-authority.js", "utf8");

function makeControl(selector, key, checked = false) {
  return {
    checked,
    value: key,
    name: "order",
    dataset: { orderId: key }
  };
}

(async () => {
  const active = makeControl(".order-checkbox", "order-1", true);
  const billing = makeControl(".billing-checkbox", "order-2", true);
  const all = makeControl(".all-order-checkbox", "order-3", false);

  const rows = {
    ".order-checkbox": [active],
    ".billing-checkbox": [billing],
    ".all-order-checkbox": [all]
  };

  const context = {
    console,
    Promise,
    window: {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      },
      GVData: { sync: async () => ({ ok: true }) },
      GVUI: {
        renderAll: () => {
          for (const controls of Object.values(rows)) {
            for (const control of controls) control.checked = false;
          }
          rows[".order-checkbox"] = [makeControl(".order-checkbox", "order-1")];
          rows[".billing-checkbox"] = [makeControl(".billing-checkbox", "order-2")];
          rows[".all-order-checkbox"] = [makeControl(".all-order-checkbox", "order-3")];
        }
      },
      getSyncQueue: () => [],
      addEventListener: (_name, handler) => handler()
    },
    document: {
      querySelectorAll: (selector) => rows[selector] || []
    }
  };

  context.window.window = context.window;
  vm.runInNewContext(source, context, { filename: "sync-queue-authority.js" });

  context.window.GVUI.renderAll();

  assert.equal(rows[".order-checkbox"][0].checked, true);
  assert.equal(rows[".billing-checkbox"][0].checked, true);
  assert.equal(rows[".all-order-checkbox"][0].checked, false);

  console.log("Sprint 20 bulk selection preservation runtime contract: PASS");
})();