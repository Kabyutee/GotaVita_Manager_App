/* GotaVita Manager — synchronization status UI boundary. */
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
        : (window.GVSync ? window.GVSync.meta() : {});
    } catch (_) {
      return {};
    }
  }

  function status(){
    const q = queue().length;
    const online = navigator.onLine !== false;
    const m = meta();

    if (!online) return "offline";
    if (m.lastSyncStatus === "partial-sync" || m.lastSyncStatus === "sync-error") return "sync-error";
    if (m.lastSyncStatus === "conflict" || (q && m.failedResources?.length)) return "sync-error";
    if (m.lastSyncStatus === "syncing") return "syncing";
    return q ? "sync-pending" : "online";
  }

  function failureDetail(){
    const m = meta();
    const failed = Array.isArray(m.failedResources) ? m.failedResources : [];
    const errors = m.failedErrors && typeof m.failedErrors === "object" ? m.failedErrors : {};
    if (m.lastSyncError) return String(m.lastSyncError);
    if (!failed.length) return "";
    const first = failed[0];
    return `${first}: ${String(errors[first] || "cloud synchronization failed")}`;
  }

  window.GVSyncStatus = Object.freeze({
    get: status,
    detail: failureDetail,
    label(){
      const s = status();
      if (s === "online") return "Synced ✓";
      if (s === "offline") return "Offline";
      if (s === "syncing") return "Checking cloud…";
      if (s === "sync-error") {
        const detail = failureDetail();
        return detail ? `Sync blocked · ${detail}` : "Sync blocked";
      }
      return "Sync pending";
    }
  });

  function loadCanonicalPreservationBridge() {
    if (document.querySelector('script[data-gv-canonical-preservation="true"]')) return;
    const script = document.createElement("script");
    script.src = `/js/core/canonical-preservation-bridge.js?v=${Date.now()}`;
    script.defer = true;
    script.dataset.gvCanonicalPreservation = "true";
    (document.head || document.documentElement).appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadCanonicalPreservationBridge, { once: true });
  } else {
    loadCanonicalPreservationBridge();
  }
})();
