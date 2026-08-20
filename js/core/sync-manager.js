/* GotaVita Manager — Phase 5 Sprint 5.5 synchronization compatibility boundary */
(function () {
  "use strict";

  // Sprint 5.5 hardening: use the application's authoritative sync queue.
  // The older standalone queue used a different localStorage key and could
  // report "Synced" while the real application queue still had resources.
  //
  // ANTI BIG BANG 2.0 — live cross-device gate:
  // - queued local changes are pushed through GVData.sync().
  // - when the queue is empty, GVData.sync() is still called so an already
  //   open second device can pull remote changes.
  // - polling never clears or mutates the queue itself; GVData remains the
  //   single synchronization authority.
  const LEGACY_KEY = "gotavita_sync_queue_v1";
  const LEGACY_META = "gotavita_sync_meta_v1";
  const POLL_MS = 5000;

  let pollTimer = null;
  let pollInFlight = false;
  let pendingRender = false;
  let renderHooksInstalled = false;

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

  function activeFormInteraction() {
    try {
      const active = document.activeElement;
      if (active && active.matches && active.matches("input, select, textarea, button, [contenteditable='true']")) {
        return true;
      }
      return !!document.querySelector(
        "form:focus-within, [role='dialog']:focus-within, .modal:focus-within"
      );
    } catch (_) {
      return false;
    }
  }

  function renderAfterInteraction() {
    if (!pendingRender || activeFormInteraction()) return;
    pendingRender = false;
    try {
      if (window.GVUI && typeof window.GVUI.renderAll === "function") {
        window.GVUI.renderAll();
      }
    } catch (renderError) {
      console.warn(
        "GotaVita deferred background sync render skipped:",
        renderError?.message || renderError
      );
    }
  }

  function installRenderProtection() {
    if (renderHooksInstalled || typeof document === "undefined") return;
    renderHooksInstalled = true;

    // A remote sync may complete while the user is changing a select/input.
    // Defer only the destructive full render; the synchronized state remains
    // authoritative in memory and can be rendered immediately after editing.
    document.addEventListener("focusout", () => {
      setTimeout(renderAfterInteraction, 0);
    }, true);
  }

  function renderSyncedState() {
    installRenderProtection();
    if (activeFormInteraction()) {
      pendingRender = true;
      return;
    }

    pendingRender = false;
    try {
      if (window.GVUI && typeof window.GVUI.renderAll === "function") {
        window.GVUI.renderAll();
      }
    } catch (renderError) {
      console.warn(
        "GotaVita background sync render skipped:",
        renderError?.message || renderError
      );
    }
  }

  async function flush() {
    const queue = appQueue();
    if (!navigator.onLine) return { ok: false, status: "offline", queued: queue.length };
    if (!window.GVData || typeof window.GVData.sync !== "function") return { ok: false, status: "unavailable", queued: queue.length };

    // Do not short-circuit when the queue is empty. A second device normally
    // has no local queue but still needs to pull a change created elsewhere.
    try {
      const result = await window.GVData.sync(true);
      if (result !== false) {
        // GVData.sync() is the authoritative state synchronization boundary.
        // Never destroy an active form/select interaction with a full render.
        // The state is already synchronized; rendering is deferred until the
        // user leaves the active form controls.
        renderSyncedState();

        try {
          const meta = JSON.parse(localStorage.getItem(LEGACY_META) || "{}");
          meta.lastSyncAt = new Date().toISOString();
          localStorage.setItem(LEGACY_META, JSON.stringify(meta));
        } catch (_) {}
        return { ok: true, status: "synced", queued: appQueue().length, result };
      }
      return { ok: false, status: "sync-error", queued: appQueue().length };
    } catch (err) {
      return { ok: false, status: "sync-error", queued: appQueue().length, error: String(err?.message || err) };
    }
  }

  async function poll() {
    if (pollInFlight) return;
    if (!navigator.onLine) return;
    if (!window.GVAuth?.isAuthorized?.()) return;
    pollInFlight = true;
    try {
      await flush();
    } finally {
      pollInFlight = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    installRenderProtection();
    pollTimer = setInterval(() => {
      poll().catch(() => {});
    }, POLL_MS);
    poll().catch(() => {});
  }

  window.GVSync = Object.freeze({
    enqueue,
    flush,
    poll,
    startPolling,
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
  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) startPolling();
  });

  // Start the timer unconditionally. poll() itself remains authorization-gated,
  // so signed-out sessions do not access cloud data. This removes a lifecycle
  // race where authentication can complete without emitting the expected
  // event after the sync manager has initialized.
  startPolling();
})();
