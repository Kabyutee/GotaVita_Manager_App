/* GotaVita Manager — Phase 5 Sprint 5.5 sync status UI boundary */
(function(){
  "use strict";
  function status(){
    const q = typeof window.getSyncQueue === "function" ? window.getSyncQueue().length : (window.GVSync ? window.GVSync.queue().length : 0);
    const online = navigator.onLine;
    return online ? (q ? "sync-pending" : "online") : "offline";
  }
  window.GVSyncStatus = Object.freeze({
    get: status,
    label(){ const s=status(); return s==='online'?'Synced ✓':s==='offline'?'Offline':'Sync pending'; }
  });

  /*
   * Sprint 12 — live cross-device render gate.
   *
   * Background polling already pulls remote state through GVData.sync().
   * The remaining UI gap was that a successful background pull could update
   * application state without entering the existing render boundary. Tab
   * navigation then appeared to "fix" synchronization because it rendered.
   *
   * Keep GVData as the synchronization authority and add only the missing
   * presentation step: after sync completes, render the current state.
   * No queue mutation, transport change, or data ownership change occurs here.
   */
  (function installPostSyncRenderGate(){
    const gateway = window.GVData;

    if (!gateway || typeof gateway.sync !== "function") {
      return;
    }

    if (gateway.__gvPostSyncRenderGateInstalled) {
      return;
    }

    const originalSync = gateway.sync.bind(gateway);

    gateway.sync = async function(){
      const result = await originalSync(...arguments);

      try {
        if (
          result !== false &&
          window.GVUI &&
          typeof window.GVUI.renderAll === "function"
        ) {
          window.GVUI.renderAll();
        }
      } catch (error) {
        console.warn(
          "GotaVita background sync render skipped:",
          error?.message || error
        );
      }

      return result;
    };

    try {
      Object.defineProperty(
        gateway,
        "__gvPostSyncRenderGateInstalled",
        { value: true, configurable: false, enumerable: false }
      );
    } catch (_) {}
  })();
})();
