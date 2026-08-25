/* GotaVita Manager — Sprint 21 canonical synchronization coordinator. */
(function () {
  "use strict";

  const POLL_MS = 5000;
  const META_KEY = "gotavita_sync_meta_v1";
  const QUEUE_KEY = "gotavita_sync_queue_v1";
  const INTERACTION_RELEASE_MS = 250;

  let timer = null;
  let inFlight = false;
  let activeInteraction = false;
  let deferredRender = false;
  let releaseTimer = null;
  let conflictPromise = null;

  function readJson(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }

  function queue() {
    try { if (typeof window.getSyncQueue === "function") return window.getSyncQueue(); }
    catch (_) {}
    const legacy = readJson(QUEUE_KEY, []);
    return Array.isArray(legacy) ? legacy : [];
  }

  function clearQueue() {
    try { if (typeof window.setSyncQueue === "function") window.setSyncQueue([]); }
    catch (_) {}
    try { localStorage.removeItem(QUEUE_KEY); } catch (_) {}
  }

  function createQueueId() {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now()}-${performance.now().toString(36)}`;
  }

  function enqueue(payload, entity = "state", action = "upsert") {
    const resources = Array.isArray(payload) ? payload.filter(Boolean) : [entity].filter(Boolean);
    try {
      if (typeof window.queueSyncResources === "function") {
        window.queueSyncResources(resources.length ? resources : ["state"]);
        return resources[0] || "state";
      }
    } catch (_) {}

    const current = queue();
    current.push({ id: createQueueId(), entity, action, payload, createdAt: new Date().toISOString(), attempts: 0 });
    writeJson(QUEUE_KEY, current);
    return entity;
  }

  function getMeta() { return readJson(META_KEY, {}); }
  function setMeta(next) { writeJson(META_KEY, next || {}); }
  function authorized() { try { return window.GVAuth?.isAuthorized?.() === true; } catch (_) { return false; } }

  function appReady() {
    return window.__GV_APP_READY === true || (
      authorized() &&
      window.GVPerformance &&
      Number.isFinite(Number(window.GVPerformance.lastRenderMs))
    );
  }

  function activeEditableControl() {
    try { const active = document.activeElement; return active?.closest?.("input:not([type='checkbox']), select, textarea, button") || null; }
    catch (_) { return null; }
  }

  function interactionProtected() { return Boolean(activeInteraction || activeEditableControl()); }

  function beginInteraction() {
    activeInteraction = true;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  function endInteractionSoon() {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (activeEditableControl()) return;
      activeInteraction = false;
      if (deferredRender) { deferredRender = false; renderRemoteState(); }
    }, INTERACTION_RELEASE_MS);
  }

  function checkboxKey(control, index) {
    return [control.dataset?.orderId, control.dataset?.id, control.id, control.name, control.value, index]
      .find((value) => value != null && String(value) !== "")?.toString() || `index:${index}`;
  }

  function captureBulkSelections() {
    if (typeof document === "undefined") return [];
    return [...document.querySelectorAll(".order-checkbox, .billing-checkbox, .all-order-checkbox")]
      .filter((control) => control.type === "checkbox" && control.checked)
      .map((control, index) => ({ className: control.className, key: checkboxKey(control, index) }));
  }

  function restoreBulkSelections(snapshot) {
    if (!snapshot?.length || typeof document === "undefined") return;
    const wanted = new Set(snapshot.map((item) => `${item.className}::${item.key}`));
    [...document.querySelectorAll(".order-checkbox, .billing-checkbox, .all-order-checkbox")]
      .filter((control) => control.type === "checkbox")
      .forEach((control, index) => { if (wanted.has(`${control.className}::${checkboxKey(control, index)}`)) control.checked = true; });
  }

  function stateDigest(snapshot) { if (!snapshot || typeof snapshot !== "object") return ""; try { return JSON.stringify(snapshot); } catch (_) { return ""; } }

  function renderRemoteState() {
    if (interactionProtected()) { deferredRender = true; return; }
    const selections = captureBulkSelections();
    try {
      if (window.GVUI && typeof window.GVUI.renderAll === "function") window.GVUI.renderAll();
      else if (typeof window.renderAll === "function") window.renderAll();
    } catch (error) { console.warn("GotaVita sync render:", error?.message || error); return; }
    restoreBulkSelections(selections);
  }

  async function ensureConflictIntegration() {
    if (window.GVConflictIntegration?.run) return window.GVConflictIntegration;
    if (conflictPromise) return conflictPromise;
    conflictPromise = new Promise((resolve, reject) => {
      if (typeof document === "undefined") { reject(new Error("Conflict integration requires a browser document.")); return; }
      const existing = document.querySelector('script[data-gv-conflict-integration="true"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.GVConflictIntegration), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "/js/core/conflict-resolution-integration.js";
      script.defer = true;
      script.dataset.gvConflictIntegration = "true";
      script.onload = () => resolve(window.GVConflictIntegration);
      script.onerror = () => reject(new Error("Conflict integration failed to load."));
      (document.head || document.documentElement).appendChild(script);
    });
    return conflictPromise;
  }

  function ensureEmergencyRecoveryLoaded() {
    if (typeof document === "undefined") return;
    if (window.GVEmergencyRecovery) return;
    if (document.querySelector('script[data-gv-emergency-recovery="true"]')) return;
    const script = document.createElement("script");
    script.src = "/js/core/emergency-recovery.js";
    script.defer = true;
    script.dataset.gvEmergencyRecovery = "true";
    script.onerror = () => console.warn("GotaVita emergency recovery failed to load.");
    (document.head || document.documentElement).appendChild(script);
  }

  async function hydrateFirstBaseline(integration) {
    if (!window.GVData?.supportedResources || typeof window.GVData.selectResource !== "function") return false;
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;
    const baseline = integration?.getBaseline?.() || {};
    const state = window.getStateSnapshot();
    let changed = false;
    const supported = window.GVData.supportedResources();
    for (const resource of supported) {
      if (resource === "audit_logs") continue;
      const stateName = integration.resourceStateName ? integration.resourceStateName(resource) : resource;
      if (!stateName || baseline[resource]) continue;
      const localRows = Array.isArray(state[stateName]) ? state[stateName] : [];
      const remoteRows = await window.GVData.selectResource(resource);
      if (!localRows.length && remoteRows.length) { state[stateName] = remoteRows; changed = true; }
    }
    if (!changed) return false;
    const now = Date.now();
    state._meta = Object.assign({}, state._meta, { lastUpdated: now, lastSynchronizedAt: now });
    window.replaceState(state);
    if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
    return true;
  }

  async function flush() {
    if (!appReady()) return { ok: false, status: "booting", queued: queue().length };
    if (inFlight) return { ok: false, status: "busy", queued: queue().length };
    if (typeof window === "undefined" || typeof navigator === "undefined") return { ok: false, status: "unavailable", queued: queue().length };
    if (navigator.onLine === false) return { ok: false, status: "offline", queued: queue().length };
    if (!authorized()) return { ok: false, status: "unauthorized", queued: queue().length };

    inFlight = true;
    const before = typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
    const beforeDigest = stateDigest(before);
    const queuedBefore = queue().length;
    try {
      const integration = await ensureConflictIntegration();
      if (!integration?.run) throw new Error("Canonical conflict/sync integration is unavailable.");
      window.__GV_SYNC_TRANSACTION_ACTIVE = true;
      await hydrateFirstBaseline(integration);
      if (typeof window.GVGroupMembershipBridge?.reconcileCurrentState === "function") window.GVGroupMembershipBridge.reconcileCurrentState();

      const originalPersist = window.persistState;
      let result;
      if (typeof originalPersist === "function") {
        const originalSyncChanged = window.syncChangedResources;
        const originalSyncNow = window.syncNow;
        window.syncChangedResources = () => Promise.resolve(false);
        window.syncNow = () => Promise.resolve(false);
        try { result = await integration.run(true); }
        finally { window.syncChangedResources = originalSyncChanged; window.syncNow = originalSyncNow; }
      } else result = await integration.run(true);

      let deletionApplied = false;
      try {
        if (typeof window.GVOrderDeleteReconciliation?.apply === "function") {
          deletionApplied = await window.GVOrderDeleteReconciliation.apply();
        }
      } catch (error) {
        console.warn("GotaVita order tombstone apply:", error?.message || error);
      }

      const after = typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
      const changed = beforeDigest !== stateDigest(after);
      if (result?.ok === true) {
        const manualReview = result.status === "manual-review";
        if (!manualReview) clearQueue();
        const meta = getMeta();
        setMeta({
          ...meta,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: manualReview ? "conflict" : (result.status || "synced"),
          lastSyncQueuedBefore: queuedBefore,
          lastSyncStateChanged: changed,
          lastSyncResults: result.results || [],
          lastDeletionApplied: deletionApplied
        });
        if (changed) renderRemoteState();
        return { ok: !manualReview, status: manualReview ? "conflict" : (result.status || "synced"), queued: queue().length, stateChanged: changed, remoteChanged: changed, renderRequired: changed, deletionApplied, result };
      }
      setMeta({ ...getMeta(), lastSyncAt: new Date().toISOString(), lastSyncStatus: result?.status || "sync-error", lastDeletionApplied: deletionApplied });
      return { ok: false, status: result?.status || "sync-error", queued: queue().length, deletionApplied, result };
    } catch (error) {
      const message = String(error?.message || error);
      setMeta({ ...getMeta(), lastSyncAt: new Date().toISOString(), lastSyncStatus: "sync-error", lastSyncError: message });
      return { ok: false, status: "sync-error", queued: queue().length, error: message };
    } finally {
      window.__GV_SYNC_TRANSACTION_ACTIVE = false;
      inFlight = false;
    }
  }

  async function poll() { return flush(); }
  function startPolling() {
    if (!authorized() && window.__GV_APP_READY !== true) return;
    if (timer) return;
    timer = setInterval(() => { flush().catch(() => {}); }, POLL_MS);
    flush().catch(() => {});
  }
  function stopPolling() { if (!timer) return; clearInterval(timer); timer = null; }

  function attachLifecycle() {
    if (typeof document === "undefined") return;
    document.addEventListener("pointerdown", (event) => { const target = event.target?.closest?.("input:not([type='checkbox']), select, textarea, button"); if (target) beginInteraction(); }, true);
    document.addEventListener("keydown", (event) => { const target = event.target?.closest?.("input:not([type='checkbox']), select, textarea, button"); if (target) beginInteraction(); }, true);
    document.addEventListener("focusin", (event) => { const target = event.target?.closest?.("input:not([type='checkbox']), select, textarea, button"); if (target) beginInteraction(); }, true);
    document.addEventListener("focusout", (event) => { const target = event.target?.closest?.("input:not([type='checkbox']), select, textarea, button"); if (target) endInteractionSoon(); }, true);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (appReady() || authorized())) flush().catch(() => {}); });
    window.addEventListener("online", () => { if (appReady() || authorized()) flush().catch(() => {}); });
    window.addEventListener("focus", () => { if (appReady() || authorized()) flush().catch(() => {}); });
    window.addEventListener("pageshow", () => { if (appReady() || authorized()) flush().catch(() => {}); });
    window.addEventListener("gv-auth-state-changed", (event) => {
      if (event?.detail?.authenticated === true) { startPolling(); flush().catch(() => {}); }
      else stopPolling();
    });
  }

  window.GVSync = Object.freeze({ enqueue, flush, poll, startPolling, stopPolling, queue, meta: getMeta, clear: clearQueue, render: renderRemoteState });

  window.addEventListener("DOMContentLoaded", () => {
    ensureEmergencyRecoveryLoaded();
    if (typeof window.stopSyncReliability === "function") window.stopSyncReliability();
    window.syncChangedResources = () => window.GVSync.flush();
    window.syncNow = () => window.GVSync.flush();
    window.startSyncReliability = () => {};
    startPolling();
  }, { once: true });

  attachLifecycle();
  if (window.__GV_APP_READY === true) {
    ensureEmergencyRecoveryLoaded();
    startPolling();
  }
})();
