/* GotaVita Manager — durable Order mutation -> sync queue boundary. */
(function () {
  "use strict";

  let installed = false;

  function queueOrders() {
    try {
      if (typeof window.queueSyncResources === "function") {
        window.queueSyncResources(["orders"]);
      }
    } catch (error) {
      console.warn("GotaVita Order sync queue boundary:", error?.message || error);
    }
  }

  function wrapBefore(name) {
    if (typeof window[name] !== "function") return false;
    const original = window[name];
    if (original.__GV_ORDER_WRITE_WRAPPED__) return true;
    function wrapped(...args) {
      queueOrders();
      return original.apply(this, args);
    }
    Object.defineProperty(wrapped, "__GV_ORDER_WRITE_WRAPPED__", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    window[name] = wrapped;
    return true;
  }

  function install() {
    if (installed) return;
    const wrapped = [
      "handleOrderSubmit",
      "handleOrderEditSubmit",
      "archiveOrders"
    ].map(wrapBefore);
    installed = wrapped.some(Boolean);
    if (installed) window.__GV_ORDER_WRITE_BOUNDARY_BRIDGE__ = true;
  }

  function boot() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const retry = () => {
      install();
      if (!installed) setTimeout(retry, 50);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", retry, { once: true });
    } else {
      retry();
    }
  }

  boot();
})();
