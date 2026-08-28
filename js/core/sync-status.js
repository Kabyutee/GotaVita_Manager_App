/* GotaVita Manager — synchronization status presentation boundary. */
(function () {
  "use strict";

  function meta() {
    try {
      return typeof window.GVSync?.meta === "function" ? window.GVSync.meta() : {};
    } catch (_) {
      return {};
    }
  }

  function status() {
    const m = meta();
    const online = navigator.onLine !== false;

    if (!online) return "offline";
    if (m.status === "partial" || m.status === "error") return "sync-error";
    if (m.status === "syncing") return "syncing";
    return "online";
  }

  function failureDetail() {
    const m = meta();
    if (m.error) return String(m.error);
    const failures = Array.isArray(m.failures) ? m.failures : [];
    if (!failures.length) return "";
    return String(failures[0]?.error || failures[0]?.resource || "cloud synchronization failed");
  }

  window.GVSyncStatus = Object.freeze({
    get: status,
    detail: failureDetail,
    label() {
      const current = status();
      if (current === "online") return "Synced ✓";
      if (current === "offline") return "Offline";
      if (current === "syncing") return "Checking cloud…";
      const detail = failureDetail();
      return detail ? `Sync blocked · ${detail}` : "Sync blocked";
    }
  });
})();