/* JARVIS runtime activation: load canonical sync boundaries only after the
deferred application scripts have finished bootstrapping. */
(function () {
  "use strict";

  const MODULES = [
    "/js/core/sync-cloud-write-reconciler.js",
    "/js/core/sync-queue-authority.js",
    "/js/core/sync-authority.js",
    "/js/core/sync-tombstone-legacy-id-bridge.js",
    "/js/core/order-mutation-transaction-guard.js",
    "/js/core/order-remote-pull-fix.js"
  ];

  function load(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-gv-runtime-sync="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.defer = false;
      script.dataset.gvRuntimeSync = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function activate() {
    try {
      for (const src of MODULES) await load(src);
      if (window.__GV_APP_READY !== true) return;
      if (window.GVSync?.flush) await window.GVSync.flush();
      if (window.GVOrderRemotePullFix?.pull) {
        await window.GVOrderRemotePullFix.pull();
      }
    } catch (error) {
      console.warn(
        "GotaVita canonical sync runtime activation:",
        error?.message || error
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", activate, { once: true });
  } else {
    activate();
  }
})();