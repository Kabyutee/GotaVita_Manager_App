/* GotaVita Manager — Phase 5 Sprint 5.5 synchronization compatibility boundary */
(function () {
  "use strict";

  // Sprint 5.5 hardening: use the application's authoritative sync queue.
  // The older standalone queue used a different localStorage key and could
  // report "Synced" while the real application queue still had resources.
  const LEGACY_KEY = "gotavita_sync_queue_v1";
  const LEGACY_META = "gotavita_sync_meta_v1";

  function appQueue() {
    try {
      if (typeof window.getSyncQueue === "function") return window.getSyncQueue();
    } catch (_) {}
    return [];
  }

  function enqueue(payload, entity = "state", action = "upsert") {
    const resources = Array.isArray(payload) ? payload : [entity];
    if (typeof window.queueSyncResources === "function") {
      window.queueSyncResources(resources.filter(Boolean));
      return resources[0] || "";
    }
    // Compatibility fallback only; the main app should always expose its queue.
    try {
      const q = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
      q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, entity, action, payload, createdAt: new Date().toISOString(), attempts: 0 });
      localStorage.setItem(LEGACY_KEY, JSON.stringify(q));
    } catch (_) {}
    return entity;
  }

  async function flush() {
    const queue = appQueue();
    if (!navigator.onLine) return { ok: false, status: "offline", queued: queue.length };
    if (!window.GVData || typeof window.GVData.sync !== "function") return { ok: false, status: "unavailable", queued: queue.length };
    if (!queue.length) return { ok: true, status: "idle", queued: 0 };
    try {
      const result = await window.GVData.sync(true);
      if (result !== false) {
        try {
          const meta = JSON.parse(localStorage.getItem(LEGACY_META) || "{}");
          meta.lastSyncAt = new Date().toISOString();
          localStorage.setItem(LEGACY_META, JSON.stringify(meta));
        } catch (_) {}
        return { ok: true, status: "synced", queued: appQueue().length };
      }
      return { ok: false, status: "sync-error", queued: appQueue().length };
    } catch (err) {
      return { ok: false, status: "sync-error", queued: appQueue().length, error: String(err?.message || err) };
    }
  }

  window.GVSync = Object.freeze({
    enqueue,
    flush,
    queue: appQueue,
    meta: () => {
      try { return JSON.parse(localStorage.getItem(LEGACY_META) || "{}"); } catch (_) { return {}; }
    },
    clear: () => {
      if (typeof window.setSyncQueue === "function") window.setSyncQueue([]);
      try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
    }
  });

  window.addEventListener("online", () => { try { window.GVSync.flush(); } catch (_) {} });
})();
