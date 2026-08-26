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

  function loadScript(src, flagName){
    if (window[flagName]) return;
    const loading = `${flagName}_LOADING`;
    if (window[loading]) return;
    window[loading] = true;
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.onload = () => { window[loading] = false; };
    script.onerror = () => {
      window[loading] = false;
      setTimeout(() => loadScript(src, flagName), 250);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  loadScript("/js/core/order-delete-reconciliation-bridge.js", "__GV_ORDER_DELETE_RECONCILIATION_BRIDGE__");
  loadScript("/js/core/client-delete-bridge.js", "__GV_CLIENT_DELETE_BRIDGE__");
  loadScript("/js/core/remote-canonical-field-bridge.js", "__GV_REMOTE_CANONICAL_FIELD_BRIDGE__");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(() => loadScript("/js/core/form-submit-delegation.js", "__GV_FORM_SUBMIT_DELEGATION__"), 0), { once: true });
  } else {
    setTimeout(() => loadScript("/js/core/form-submit-delegation.js", "__GV_FORM_SUBMIT_DELEGATION__"), 0);
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
})();