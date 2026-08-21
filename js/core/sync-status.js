/* GotaVita Manager — synchronization status UI boundary */
(function(){
  "use strict";

  function queue(){
    try {
      return typeof window.getSyncQueue === "function"
        ? window.getSyncQueue()
        : (window.GVSync ? window.GVSync.queue() : []);
    } catch (_) {
      return [];
    }
  }

  function meta(){
    try {
      return typeof window.getSyncMeta === "function"
        ? window.getSyncMeta()
        : {};
    } catch (_) {
      return {};
    }
  }

  function status(){
    const q = queue().length;
    const online = navigator.onLine !== false;
    const m = meta();

    if (!online) return "offline";
    if (m.lastSyncStatus === "partial-sync" || (q && m.failedResources?.length)) return "sync-error";
    return q ? "sync-pending" : "online";
  }

  function failureDetail(){
    const m = meta();
    const failed = Array.isArray(m.failedResources) ? m.failedResources : [];
    const errors = m.failedErrors && typeof m.failedErrors === "object" ? m.failedErrors : {};

    if (!failed.length) return "";

    const first = failed[0];
    return `${first}: ${String(errors[first] || "cloud write/read failed")}`;
  }

  window.GVSyncStatus = Object.freeze({
    get: status,
    detail: failureDetail,
    label(){
      const s = status();
      if (s === "online") return "Synced ✓";
      if (s === "offline") return "Offline";
      if (s === "sync-error") {
        const detail = failureDetail();
        return detail ? `Sync blocked · ${detail}` : "Sync blocked";
      }
      return "Sync pending";
    }
  });
})();
