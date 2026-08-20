/* GotaVita Manager — synchronization status UI boundary */
(function(){
  "use strict";

  function status(){
    const q = typeof window.getSyncQueue === "function"
      ? window.getSyncQueue().length
      : (window.GVSync ? window.GVSync.queue().length : 0);
    const online = navigator.onLine !== false;
    return online ? (q ? "sync-pending" : "online") : "offline";
  }

  window.GVSyncStatus = Object.freeze({
    get: status,
    label(){
      const s = status();
      return s === "online"
        ? "Synced ✓"
        : s === "offline"
          ? "Offline"
          : "Sync pending";
    }
  });
})();
