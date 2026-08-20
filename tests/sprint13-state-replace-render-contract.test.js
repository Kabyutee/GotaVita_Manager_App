const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const source = fs.readFileSync("js/core/sync-manager.js", "utf8");

let syncCalls = 0;
let renderCalls = 0;
let scheduled = null;
let activeElement = null;

function makeControl(tagName = "select") {
  return {
    tagName,
    id: "order-log-filter",
    name: "orderLogFilter",
    type: "checkbox",
    closest: (selector) => /input|select|textarea|button/.test(selector) ? control : null,
    focus: () => { activeElement = control; }
  };
}

const control = makeControl();
const document = {
  activeElement,
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null
};
Object.defineProperty(document, "activeElement", {
  get: () => activeElement
});

const context = {
  console,
  Date,
  JSON,
  Math,
  Promise,
  navigator: { onLine: true },
  document,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  setInterval: (handler, ms) => {
    scheduled = { handler, ms };
    return 1;
  },
  window: {
    GVAuth: { isAuthorized: () => true },
    GVData: {
      sync: async () => {
        syncCalls++;
        return { ok: true, status: "synced" };
      }
    },
    GVUI: {
      renderAll: () => {
        renderCalls++;
      }
    },
    getSyncQueue: () => [],
    addEventListener: () => {}
  }
};

context.window.window = context.window;
vm.runInNewContext(source, context, { filename: "sync-manager.js" });

(async () => {
  await Promise.resolve();
  assert.equal(syncCalls, 1, "Authorized startup must perform an initial sync");

  activeElement = control;

  await context.window.GVSync.flush();
  assert.equal(syncCalls, 2, "Flush must invoke the shared sync gateway");
  assert.equal(
    renderCalls,
    0,
    "Background sync must not rebuild the UI while a form/select control is focused"
  );

  activeElement = null;
  await context.window.GVSync.flush();
  assert.equal(syncCalls, 3);
  assert.equal(
    renderCalls,
    1,
    "A render is allowed again after the focused interaction ends"
  );

  assert.ok(scheduled, "Polling must still be installed");
  assert.equal(scheduled.ms, 5000, "Live-sync polling must remain at 5 seconds");

  console.log("Sprint 13 state-replace/render boundary contract: PASS");
})();
