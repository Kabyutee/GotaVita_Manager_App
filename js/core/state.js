/* GotaVita Manager — Phase 4.5 State Factory */
(function(){
  "use strict";

  function numericOrderNumber(value) {
    const n = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function reconcileOrderCounterBeforeCreate() {
    try {
      if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return;

      const snapshot = window.getStateSnapshot();
      if (!snapshot || typeof snapshot !== "object") return;

      const rows = [
        ...(Array.isArray(snapshot.orders) ? snapshot.orders : []),
        ...(Array.isArray(snapshot.deletedOrders) ? snapshot.deletedOrders : [])
      ];

      let maxOrderNumber = Number(snapshot.orderCounter) || 0;
      for (const row of rows) {
        maxOrderNumber = Math.max(maxOrderNumber, numericOrderNumber(row?.orderNumber));
      }

      if (maxOrderNumber !== (Number(snapshot.orderCounter) || 0)) {
        snapshot.orderCounter = maxOrderNumber;
        window.replaceState(snapshot);
      }
    } catch (error) {
      console.warn("GotaVita order-number counter reconciliation skipped:", error?.message || error);
    }
  }

  window.GV_STATE=Object.freeze({createInitialState:function(){return {products:[],clients:[],services:[],orders:[],payments:[],expenses:[],payrollRecords:[],employees:[],orderGroups:[],deliveryRoutes:[],orderGroupItems:[],deliveryRouteItems:[],dailyReports:[],dailyRuns:[],deletedOrders:[],auditLog:[],orderCounter:138,_meta:{schemaVersion:3,lastUpdated:0,deviceId:""}};}});

  function loadScriptSequentially(src, markerName, markerValue, next) {
    const selector = `script[${markerName}="${markerValue}"]`;
    if (document.querySelector(selector)) return next?.();

    const script = document.createElement("script");
    script.src = src;
    script.defer = false;
    script.setAttribute(markerName, markerValue);
    script.onload = () => next?.();
    script.onerror = () => console.warn(`GotaVita module failed to load: ${src}`);
    document.head.appendChild(script);
  }

  function loadDailyL300Module(next) {
    loadScriptSequentially("/js/modules/daily-l300-runs.js", "data-gv-module", "daily-l300-runs", next);
  }

  function loadL300ReportingAdapter(next) {
    loadScriptSequentially("/js/modules/l300-reporting-adapter.js", "data-gv-module", "l300-reporting-adapter", next);
  }

  function loadL300OperationsDashboard() {
    loadScriptSequentially("/js/modules/l300-operations-dashboard.js", "data-gv-module", "l300-operations-dashboard");
  }

  function loadCanonicalSyncRuntime() {
    if (document.querySelector('script[data-gv-runtime-sync-loader="true"]')) return;
    const script = document.createElement("script");
    script.src = "/js/core/sync-runtime-activation.js";
    script.defer = false;
    script.dataset.gvRuntimeSyncLoader = "true";
    script.onerror = () => console.warn("GotaVita canonical sync runtime activation failed to load.");
    document.head.appendChild(script);
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("submit", function(event) {
      const target = event?.target;
      if (target?.id === "orderForm") reconcileOrderCounterBeforeCreate();
    }, { capture: true });

    document.addEventListener("DOMContentLoaded", function () {
      loadDailyL300Module(() => {
        loadL300ReportingAdapter(() => {
          loadL300OperationsDashboard();
        });
      });
      loadCanonicalSyncRuntime();
    }, { once: true });
  }
})();
