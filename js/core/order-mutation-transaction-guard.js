/* GotaVita Manager — serialize Order mutations against stale sync snapshots. */
(function () {
  "use strict";

  const HANDLERS = Object.freeze([
    "handleOrderSubmit",
    "handleOrderEditSubmit",
    "archiveOrders"
  ]);
  const HANDLER_MARKER = "__GV_ORDER_MUTATION_TRANSACTION_GUARD__";
  const FLUSH_MARKER = "__GV_ORDER_MUTATION_FLUSH_GUARD__";
  let handlerInstalled = false;
  let flushIdentity = null;

  function epoch() {
    return Number(window.__GV_ORDER_MUTATION_EPOCH || 0);
  }

  function bumpEpoch() {
    window.__GV_ORDER_MUTATION_EPOCH = epoch() + 1;
    return window.__GV_ORDER_MUTATION_EPOCH;
  }

  function cloneState() {
    try {
      return typeof window.getStateSnapshot === "function"
        ? window.getStateSnapshot()
        : null;
    } catch (_) {
      return null;
    }
  }

  function saveLatestMutationSnapshot() {
    const snapshot = cloneState();
    if (!snapshot) return;
    window.__GV_LATEST_ORDER_MUTATION_SNAPSHOT = snapshot;
    window.__GV_LATEST_ORDER_MUTATION_SNAPSHOT_EPOCH = epoch();
  }

  function wrapHandler(name) {
    const original = window[name];
    if (typeof original !== "function") return false;
    if (original[HANDLER_MARKER]) return true;

    async function guardedHandler(...args) {
      bumpEpoch();
      try {
        return await original.apply(this, args);
      } finally {
        saveLatestMutationSnapshot();
      }
    }

    Object.defineProperty(guardedHandler, HANDLER_MARKER, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });

    window[name] = guardedHandler;
    return true;
  }

  function installHandlers() {
    if (handlerInstalled) return true;
    if (window.__GV_ORDER_WRITE_BOUNDARY_BRIDGE__ !== true) return false;
    handlerInstalled = HANDLERS.every(wrapHandler);
    if (handlerInstalled) {
      window.__GV_ORDER_MUTATION_EPOCH = epoch();
    }
    return handlerInstalled;
  }

  function restoreLatestOrderSnapshot(epochAtFlushStart) {
    const currentEpoch = epoch();
    if (currentEpoch === epochAtFlushStart) return false;

    const snapshotEpoch = Number(window.__GV_LATEST_ORDER_MUTATION_SNAPSHOT_EPOCH || 0);
    if (snapshotEpoch !== currentEpoch) return false;

    const snapshot = window.__GV_LATEST_ORDER_MUTATION_SNAPSHOT;
    if (!snapshot || typeof window.replaceState !== "function") return false;

    try {
      window.replaceState(snapshot);
      if (typeof window.writeLocalStateSnapshot === "function") {
        window.writeLocalStateSnapshot(snapshot);
      }
      try {
        if (window.GVUI?.renderAll) window.GVUI.renderAll();
        else if (typeof window.renderAll === "function") window.renderAll();
      } catch (_) {}
      return true;
    } catch (error) {
      console.warn("GotaVita Order transaction restore:", error?.message || error);
      return false;
    }
  }

  function installFlushGuard() {
    const sync = window.GVSync;
    if (!sync || typeof sync.flush !== "function") return false;
    if (sync.flush[FLUSH_MARKER]) {
      flushIdentity = sync.flush;
      return true;
    }
    if (flushIdentity === sync.flush) return true;

    const originalFlush = sync.flush;
    async function guardedFlush(...args) {
      const epochAtFlushStart = epoch();
      const result = await originalFlush.apply(this, args);
      const restored = restoreLatestOrderSnapshot(epochAtFlushStart);
      if (restored) {
        return {
          ...(result || {}),
          orderMutationRestored: true,
          stateChanged: true,
          renderRequired: true
        };
      }
      return result;
    }

    Object.defineProperty(guardedFlush, FLUSH_MARKER, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });

    window.GVSync = Object.freeze({
      ...sync,
      flush: guardedFlush,
      poll: guardedFlush
    });
    flushIdentity = guardedFlush;
    return true;
  }

  function activate() {
    installHandlers();
    installFlushGuard();
    if (!handlerInstalled || !window.GVSync?.flush) {
      setTimeout(activate, 25);
    } else {
      setTimeout(activate, 100);
    }
  }

  activate();

  window.GVOrderMutationTransactionGuard = Object.freeze({
    epoch,
    restoreLatestOrderSnapshot
  });
})();
