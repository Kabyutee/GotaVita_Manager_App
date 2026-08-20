/* GotaVita Manager — Phase 5 Sprint 5.5 synchronization compatibility boundary */
(function () {
  "use strict";

  // Sprint 5.5 hardening: use the application's authoritative sync queue.
  // The older standalone queue used a different localStorage key and could
  // report "Synced" while the real application queue still had resources.
  //
  // ANTI BIG BANG 2.2 — live cross-device gate:
  // - queued local changes are pushed through GVData.sync().
  // - when the queue is empty, GVData.sync() is still called so an already
  //   open second device can pull remote changes.
  // - polling never clears or mutates the queue itself; GVData remains the
  //   single synchronization authority.
  // - background sync must never rebuild the UI while a user is actively
  //   interacting with a form/select control.
  // - sync continues during protected interaction; only the destructive UI
  //   render is deferred until the interaction is safely finished.
  //
  // ANTI BIG BANG 3.0 / Sprint 17:
  // - a successful gateway/auth check is NOT itself a remote-state change.
  // - renderAll() is therefore allowed only when GVData.sync() explicitly
  //   reports that remote state changed (or legacy boolean true is returned).
  // - this prevents a 15-second background health/sync check from rebuilding
  //   Order Log while a user is selecting/filtering orders.
  const LEGACY_KEY = "gotavita_sync_queue_v1";
  const LEGACY_META = "gotavita_sync_meta_v1";
  const POLL_MS = 5000;
  const INTERACTION_RELEASE_MS = 250;

  let pollTimer = null;
  let pollInFlight = false;
  let interactionReleaseTimer = null;
  let activeInteraction = false;
  let deferredRender = false;

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
    const byKey = new Map(
      controls.map((control, index) => [getControlKey(control, index), control])
    );

    for (const item of snapshot.values) {
      const control = byKey.get(item.key);
      if (!control) continue;

      try {
        if (control.tagName === "SELECT" && control.multiple && Array.isArray(item.selectedValues)) {
          const selected = new Set(item.selectedValues.map(String));
          for (const option of control.options) {
            option.selected = selected.has(String(option.value));
          }
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
      active = container.querySelector(`[name="${CSS.escape(snapshot.activeName)}"]`);
    }
    try { active?.focus?.(); } catch (_) {}
  }

  // ANTI BIG BANG 2.2 — the focused control is the authoritative interaction
  // boundary. Native select/checkbox popups can release pointer events while
  // the control remains focused, so pointerup timing alone is insufficient.
  function activeFormControl() {
    try {
      const active = document.activeElement;
      return active?.closest?.("input, select, textarea, button") || null;
    } catch (_) {
      return null;
    }
  }

  function interactionIsProtected() {
    return Boolean(activeInteraction || activeFormControl());
  }

  function beginUserInteraction() {
    activeInteraction = true;
    if (interactionReleaseTimer) {
      clearTimeout(interactionReleaseTimer);
      interactionReleaseTimer = null;
    }
  }

  function endUserInteractionSoon() {
    if (interactionReleaseTimer) clearTimeout(interactionReleaseTimer);
    interactionReleaseTimer = setTimeout(() => {
      interactionReleaseTimer = null;

      // A native select/checkbox can remain focused after pointerup/change.
      // Keep the render deferred until focus has actually left the control.
      if (activeFormControl()) return;

      activeInteraction = false;

      if (deferredRender) {
        deferredRender = false;
        renderSyncedState();
      }
    }, INTERACTION_RELEASE_MS);
  }

  function installInteractionGuard() {
    // Browser-only interaction protection. The sync manager is also loaded by
    // Node/VM contract tests, where document is intentionally unavailable.
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return;
    }

    document.addEventListener("pointerdown", (event) => {
      const control = event.target?.closest?.("input, select, textarea, button");
      if (control) beginUserInteraction();
    }, true);

    document.addEventListener("keydown", (event) => {
      const control = event.target?.closest?.("input, select, textarea, button");
      if (control) beginUserInteraction();
    }, true);

    document.addEventListener("focusin", (event) => {
      const control = event.target?.closest?.("input, select, textarea, button");
      if (control) beginUserInteraction();
    }, true);

    document.addEventListener("focusout", (event) => {
      const control = event.target?.closest?.("input, select, textarea, button");
      if (control) endUserInteractionSoon();
    }, true);
  }

  function renderSyncedState() {
    if (interactionIsProtected()) {
      deferredRender = true;
      return;
    }

    const formState = captureActiveFormState();

    try {
      if (window.GVUI && typeof window.GVUI.renderAll === "function") {
        window.GVUI.renderAll();
      }
    } catch (renderError) {
      console.warn(
        "GotaVita background sync render skipped:",
        renderError?.message || renderError
      );
      return;
    }

    restoreActiveFormState(formState);
  }

  function syncResultRequiresRender(result) {
    return result === true || Boolean(
      result && (
        result.remoteChanged === true ||
        result.stateChanged === true ||
        result.renderRequired === true
      )
    );
  }

  async function flush() {
    const queue = appQueue();
    if (!navigator.onLine) return { ok: false, status: "offline", queued: queue.length };
    if (!window.GVData || typeof window.GVData.sync !== "function") return { ok: false, status: "unavailable", queued: queue.length };

    try {
      const result = await window.GVData.sync(true);
      if (result !== false) {
        if (syncResultRequiresRender(result)) {
          renderSyncedState();
        }

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

  installInteractionGuard();

  // Start the timer unconditionally. poll() itself remains authorization-gated,
  // so signed-out sessions do not access cloud data. This removes a lifecycle
  // race where authentication can complete without emitting the expected
  // event after the sync manager has initialized.
  startPolling();
})();
