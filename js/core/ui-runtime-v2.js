/* GotaVita UI runtime v2 — presentation boundary only. */
(function () {
  "use strict";

  function rebindDynamicOrderForms() {
    try {
      const guard = window.guardedSubmitHandler;
      const forms = [
        ["orderForm", "order-form-submit", "handleOrderSubmit"],
        ["orderEditForm", "order-edit-submit", "handleOrderEditSubmit"]
      ];
      if (typeof guard !== "function") return;

      for (const [formId, key, handlerName] of forms) {
        const form = document.getElementById(formId);
        const handler = window[handlerName];
        if (!form || typeof handler !== "function" || form.__gvSubmitBound) continue;
        form.addEventListener("submit", guard(form, key, handler));
        form.__gvSubmitBound = true;
      }
    } catch (error) {
      console.warn("GotaVita dynamic order form binding skipped:", error?.message || error);
    }
  }

  window.GVUI = Object.freeze({
    renderAll() {
      const result = typeof window.renderAll === "function" ? window.renderAll() : undefined;
      rebindDynamicOrderForms();
      return result;
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

  window.addEventListener("DOMContentLoaded", () => {
    rebindDynamicOrderForms();
  }, { once: true });
})();