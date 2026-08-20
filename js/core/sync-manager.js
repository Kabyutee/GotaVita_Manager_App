/* GotaVita Manager — Phase 5 Sprint 5.5 synchronization compatibility boundary */
(function () {
  "use strict";

  const LEGACY_KEY = "gotavita_sync_queue_v1";
  const LEGACY_META = "gotavita_sync_meta_v1";
  const POLL_MS = 5000;

  let pollTimer = null;
  let pollInFlight = false;

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
    try {
      const q = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
      q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, entity, action, payload, createdAt: new Date().toISOString(), attempts: 0 });
      localStorage.setItem(LEGACY_KEY, JSON.stringify(q));
    } catch (_) {}
    return entity;
  }

  function activeFormContainer() {
    try {
      const active = document.activeElement;
      if (!active) return null;
      return active.closest?.("form, [role='dialog'], .modal") || null;
    } catch (_) {
      return null;
    }
  }

  function getControlKey(control, index) {
    if (control.id) return `id:${control.id}`;
    if (control.name) return `name:${control.name}:${index}`;
    return `index:${index}`;
  }

  function captureActiveFormState() {
    const container = activeFormContainer();
    if (!container) return null;

    const controls = [...container.querySelectorAll("input, select, textarea")];
    const values = controls.map((control, index) => ({
      key: getControlKey(control, index),
      type: control.type || control.tagName.toLowerCase(),
      value: control.value,
      checked: control.type === "checkbox" || control.type === "radio" ? control.checked : undefined,
      selectedValues:
        control.tagName === "SELECT" && control.multiple
          ? [...control.selectedOptions].map((option) => option.value)
          : undefined
    }));

    return {
      containerId: container.id || null,
      values,
      activeId: document.activeElement?.id || null,
      activeName: document.activeElement?.name || null
    };
  }

  function restoreActiveFormState(snapshot) {
    if (!snapshot) return;

    let container = snapshot.containerId ? document.getElementById(snapshot.containerId) : null;
    if (!container) container = document.querySelector("form, [role='dialog'], .modal");
    if (!container) return;

    const controls = [...container.querySelectorAll("input, select, textarea")];
    const byKey = new Map(controls.map((control, index) => [getControlKey(control, index), control]));

    for (const item of snapshot.values) {
      const control = byKey.get(item.key);
      if (!control) continue;
      try {
        if (control.tagName === "SELECT" && control.multiple && Array.isArray(item.selectedValues)) {
          const selected = new Set(item.selectedValues.map(String));
          for (const option of control.options) option.selected = selected.has(String(option.value));
        } else if (item.type === "checkbox" || item.type === "radio") {
          control.checked = Boolean(item.checked);
        } else {
          control.value = item.value;
        }
      } catch (_) {}
    }

    let active = null;
    if (snapshot.activeId) active = document.getElementById(snapshot.activeId);
    if (!active && snapshot.activeName) {
      try { active = container.querySelector(`[name="${CSS.escape(snapshot.activeName)}"]`); } catch (_) {}
    }
    try { active?.focus?.(); } catch (_) {}
  }

  function renderSyncedState() {
    const formState = captureActiveFormState();
    try {
      if (window.GVUI && typeof window.GVUI.renderAll === "function") window.GVUI.renderAll();
    } catch (renderError) {
      console.warn("GotaVita background sync render skipped:", renderError?.message || renderError);
      return;
    }
    restoreActiveFormState(formState);
  }

  async function flush() {
    const queue = appQueue();
    if (!navigator.onLine) return { ok: false, status: "offline", queued: queue.length };
    if (!window.GVData || typeof window.GVData.sync !== "function") return { ok: false, status: "unavailable", queued: queue.length };

    try {
      const result = await window.GVData.sync(true);
      if (result !== false) {
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
    try { await flush(); } finally { pollInFlight = false; }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => { poll().catch(() => {}); }, POLL_MS);
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
  startPolling();
})();
