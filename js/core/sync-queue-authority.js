/* GotaVita Manager — authoritative queue preservation boundary. */
(function () {
  "use strict";

  const BASELINE_KEY = "gotavita_sync_baseline_v1";
  let installed = false;

  function readQueue() {
    try {
      return typeof window.getSyncQueue === "function"
        ? window.getSyncQueue().filter(Boolean)
        : [];
    } catch (_) {
      return [];
    }
  }

  function readBaselineRaw() {
    try {
      return window.localStorage?.getItem(BASELINE_KEY) ?? null;
    } catch (_) {
      return null;
    }
  }

  function writeBaselineRaw(value) {
    try {
      if (value == null) window.localStorage?.removeItem(BASELINE_KEY);
      else window.localStorage?.setItem(BASELINE_KEY, value);
    } catch (_) {}
  }

  async function forceQueuedResourcesThroughSync(original, args) {
    const queued = readQueue();
    if (!queued.length) return original.sync.apply(original, args);

    const baseline = readBaselineRaw();

    // ANTI BIG BANG rule: an explicit queued resource is authoritative.
    // The bridge's baseline optimization is allowed only for idle state.
    // Temporarily removing the baseline makes the existing sync transaction
    // include queued resources while preserving its normal write/read/retry
    // behavior and failure-preserving queue semantics.
    writeBaselineRaw(null);

    try {
      return await original.sync.apply(original, args);
    } finally {
      // A successful/partial sync has already written the authoritative
      // baseline. If the sync crashed before doing so, restore the prior one.
      if (readBaselineRaw() == null && baseline != null) {
        writeBaselineRaw(baseline);
      }
    }
  }

  function install() {
    if (installed || !window.GVData || typeof window.GVData.sync !== "function") return;

    const original = window.GVData;
    const facade = Object.assign({}, original, {
      sync(...args) {
        return forceQueuedResourcesThroughSync(original, args);
      }
    });

    window.GVData = Object.freeze(facade);
    installed = true;
  }

  try { install(); } catch (error) {
    console.warn("GotaVita queue authority boundary initialization skipped:", error?.message || error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    try { install(); } catch (error) {
      console.warn("GotaVita queue authority boundary initialization skipped:", error?.message || error);
    }
  }, { once: true });
})();
