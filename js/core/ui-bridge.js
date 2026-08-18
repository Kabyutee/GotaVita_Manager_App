/* GotaVita Phase 4.5 M3 — UI Boundary
 * Central compatibility bridge for modular code to notify/render through the
 * existing UI system. Keeps current behavior while preparing a future event bus.
 */
window.GVUI = Object.freeze({
  renderAll() {
    if (typeof window.renderAll === "function") return window.renderAll();
  },
  render(view) {
    if (typeof window.renderPartial === "function") return window.renderPartial(view);
    return this.renderAll();
  },
  toast(message, type = "success") {
    if (typeof window.showToast === "function") return window.showToast(message, type);
  },
  confirm(options) {
    if (typeof window.requestConfirmation === "function") return window.requestConfirmation(options);
    return Promise.resolve(window.confirm((options && options.message) || "Are you sure?"));
  }
});
