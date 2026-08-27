/* GotaVita Manager — independent remote Order hydration. */
(function () {
  "use strict";
  const INTERVAL_MS = 2000;
  let timer = null;
  let inFlight = false;
  function idOf(row) {
    const value = row?.legacyId ?? row?.legacy_id ?? row?.legacy_payload?.legacyId ?? row?.legacy_payload?.legacy_id ?? row?.id;
    return value == null || String(value).trim() === "" ? null : String(value);
  }
  function updatedMs(row) {
    const value = row?.updatedAt ?? row?.updated_at ?? row?.createdAt ?? row?.created_at ?? "";
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : 0;
  }
  function render() {
    try {
      if (window.GVUI?.renderAll) return window.GVUI.renderAll();
      if (typeof window.renderAll === "function") return window.renderAll();
    } catch (_) {}
  }
  async function pull() {
    if (inFlight || !navigator.onLine || window.GVAuth?.isAuthorized?.() !== true) return false;
    if (!window.GVData?.selectResource || !window.getStateSnapshot || !window.replaceState) return false;
    inFlight = true;
    try {
      const remote = await window.GVData.selectResource("orders");
      if (!Array.isArray(remote)) return false;
      const state = window.getStateSnapshot();
      const local = Array.isArray(state.orders) ? state.orders.slice() : [];
      const byId = new Map(local.map((row) => [idOf(row), row]).filter(([id]) => id));
      let changed = false;
      for (const remoteRow of remote) {
        const id = idOf(remoteRow);
        if (!id) continue;
        const localRow = byId.get(id);
        if (!localRow) {
          local.push(remoteRow);
          byId.set(id, remoteRow);
          changed = true;
          continue;
        }
        if (updatedMs(remoteRow) > updatedMs(localRow)) {
          const index = local.findIndex((row) => idOf(row) === id);
          if (index >= 0) {
            local[index] = { ...remoteRow, id: local[index]?.id ?? remoteRow?.id };
            changed = true;
          }
        }
      }
      if (!changed) return false;
      state.orders = local;
      state._meta = Object.assign({}, state._meta, {
        lastUpdated: Date.now(),
        lastSynchronizedAt: Date.now(),
        lastRemoteChangedResources: ["orders"],
        lastOrderRemotePullAt: new Date().toISOString()
      });
      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);
      render();
      return true;
    } catch (error) {
      console.warn("GotaVita independent Order remote pull:", error?.message || error);
      return false;
    } finally { inFlight = false; }
  }
  function start() {
    if (timer) return;
    pull().catch(() => {});
    timer = setInterval(() => pull().catch(() => {}), INTERVAL_MS);
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }
  function authorized() {
    return window.GVAuth?.isAuthorized?.() === true;
  }
  let authBootstrapTimer = null;
  function ensureStarted() {
    if (authorized()) {
      if (authBootstrapTimer) {
        clearInterval(authBootstrapTimer);
        authBootstrapTimer = null;
      }
      start();
      return;
    }
    if (!authBootstrapTimer) {
      authBootstrapTimer = setInterval(() => {
        if (authorized()) {
          clearInterval(authBootstrapTimer);
          authBootstrapTimer = null;
          start();
        }
      }, 250);
    }
  }
  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) ensureStarted();
    else stop();
  });
  ensureStarted();
})();