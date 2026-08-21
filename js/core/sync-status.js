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

  // Sprint 20 acceptance hardening: keep an independent poll safety net.
  // The authoritative GVSync object still owns queue/state/render behavior;
  // this layer only requests another poll so a missed lifecycle event cannot
  // leave a second device stale until the user clicks a tab or button.
  function kickSync(){
    try {
      if (navigator.onLine === false) return;
      if (!window.GVSync || typeof window.GVSync.poll !== "function") return;
      if (window.GVAuth && typeof window.GVAuth.isAuthorized === "function" && !window.GVAuth.isAuthorized()) return;
      window.GVSync.poll().catch(() => {});
    } catch (_) {}
  }

  const fallbackTimer = setInterval(kickSync, 5000);
  void fallbackTimer;

  window.addEventListener("online", kickSync);
  window.addEventListener("focus", kickSync);
  window.addEventListener("pageshow", kickSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kickSync();
  });

  function loadBulkSelectionInteractionBridge(){
    if (typeof document === "undefined") return;
    if (document.querySelector('script[data-gv-sync-checkbox-interaction="true"]')) return;

    const script = document.createElement("script");
    script.src = "/js/core/sync-checkbox-interaction-bridge.js";
    script.defer = true;
    script.dataset.gvSyncCheckboxInteraction = "true";
    script.onerror = () => {
      console.warn("GotaVita bulk-selection sync continuity bridge failed to load.");
    };
    (document.head || document.documentElement).appendChild(script);
  }

  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", loadBulkSelectionInteractionBridge, { once: true });
    } else {
      loadBulkSelectionInteractionBridge();
    }
  } catch (_) {}
})();
