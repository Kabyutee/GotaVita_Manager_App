const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const uiBridgeSource = fs.readFileSync("js/core/ui-bridge.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");

assert.match(
  indexSource,
  /js\/core\/ui-bridge\.js[\s\S]*script\.js/,
  "ui-bridge.js must load before script.js"
);

async function runScenario() {
  let domReadyHandler = null;
  let healthCalls = 0;
  let hydrationReads = 0;
  let replaceCount = 0;

  const rawGateway = {
    health: async () => {
      healthCalls += 1;
      return { ok: true, mode: "supabase" };
    },
    supportedResources: () => ["clients"],
    selectResource: async () => {
      hydrationReads += 1;
      return [{ id: "cloud-client" }];
    }
  };

  const context = {
    console,
    Date,
    Map,
    Object,
    Array,
    Number,
    String,
    Promise,
    JSON,
    Error,
    window: {
      GVAuth: { isAuthorized: () => true },
      GVData: Object.freeze(rawGateway),
      getStateSnapshot: () => ({ clients: [], _meta: {} }),
      replaceState: () => { replaceCount += 1; },
      writeLocalStateSnapshot: () => {},
      addEventListener: (name, handler) => {
        if (name === "DOMContentLoaded") domReadyHandler = handler;
      }
    },
    navigator: { onLine: true }
  };

  context.window.window = context.window;
  vm.runInNewContext(uiBridgeSource, context, { filename: "ui-bridge.js" });

  assert.equal(
    typeof context.window.GVData.health,
    "function",
    "GVData.health facade must exist immediately when GVData already exists"
  );

  await context.window.GVData.health();

  assert.equal(healthCalls, 1, "The original gateway health method must remain callable");
  assert.equal(hydrationReads, 1, "Startup health must hydrate before DOMContentLoaded");
  assert.equal(replaceCount, 1, "Startup hydration must install state before DOMContentLoaded");

  assert.ok(
    domReadyHandler,
    "DOMContentLoaded fallback may remain for late gateway availability"
  );
}

runScenario()
  .then(() => console.log("Sprint 12 hydration ordering contract: PASS"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
