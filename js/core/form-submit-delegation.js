/* GotaVita Manager — durable form submit delegation. */
(function(){
  "use strict";
  function install(){
    if (document.documentElement.dataset.gvFormSubmitDelegationInstalled === "true") return;
    document.documentElement.dataset.gvFormSubmitDelegationInstalled = "true";
    document.addEventListener("submit", function(event){
      if (event.defaultPrevented) return;
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      const handlers = { orderForm: "handleOrderSubmit", orderEditForm: "handleOrderEditSubmit", expenseForm: "handleExpenseSubmit", clientForm: "handleClientSubmit", employeeForm: "handleEmployeeSubmit" };
      const handlerName = handlers[form.id];
      const handler = handlerName ? window[handlerName] : null;
      if (typeof handler !== "function") return;
      if (typeof window.guardedSubmitHandler === "function") window.guardedSubmitHandler(form, `${form.id}-delegated-submit`, handler).call(form, event);
      else handler.call(form, event);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})();
