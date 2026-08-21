/* GotaVita Manager — bulk-selection sync continuity bridge. */
(function () {
  "use strict";

  const SELECTOR = ".order-checkbox, .billing-checkbox, .all-order-checkbox";

  function isBulkCheckbox(target) {
    return Boolean(target?.matches?.(SELECTOR) && target.type === "checkbox");
  }

  function releaseFocus(target) {
    if (!isBulkCheckbox(target)) return;
    try {
      // Selection is state, not an in-progress form edit. Releasing focus lets
      // the existing sync interaction guard render remote changes while the
      // queue-authority bridge preserves the checked selection by stable ID.
      if (document.activeElement === target) target.blur();
    } catch (_) {}
  }

  if (typeof document === "undefined") return;

  document.addEventListener("change", (event) => {
    const target = event.target?.closest?.(SELECTOR);
    if (!isBulkCheckbox(target)) return;
    queueMicrotask(() => releaseFocus(target));
  }, true);

  window.GVSyncCheckboxInteraction = Object.freeze({
    releaseFocus
  });
})();
