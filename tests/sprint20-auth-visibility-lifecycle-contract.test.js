const fs = require("node:fs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const source = fs.readFileSync("js/core/sync-auth-startup-bridge.js", "utf8");

let windowVisibilityListeners = 0;
let documentVisibilityListeners = 0;
let authChecks = 0;

const context = {
  console,
  document: {
    visibilityState: "visible",
    addEventListener(name, handler) {
      if (name === "visibilitychange") {
        documentVisibilityListeners += 1;
        this.handler = handler;
      }
    }
  },
  window: {
    GVAuth: {
      isAuthorized: () => true,
      requireManagerSession: async () => {
        authChecks += 1;
        return { authenticated: true };
      }
    },
    addEventListener(name) {
      if (name === "visibilitychange") windowVisibilityListeners += 1;
    }
  }
};

context.window.window = context.window;
vm.runInNewContext(source, context, { filename: "sync-auth-startup-bridge.js" });

(async () => {
  await Promise.resolve();

  assert.equal(windowVisibilityListeners, 0, "visibilitychange must not be registered on window");
  assert.equal(documentVisibilityListeners, 1, "visibilitychange must be registered on document");
  assert.ok(authChecks >= 1, "startup must still perform an authorization check");

  context.document.visibilityState = "visible";
  context.document.handler();
  await Promise.resolve();

  assert.equal(authChecks, 2, "returning to a visible tab must revalidate the session");

  console.log("Sprint 20 auth visibility lifecycle contract: PASS");
})();
