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

  function loadDailyL300Module() {
    if (document.querySelector('script[data-gv-module="daily-l300-runs"]')) return;
    const script = document.createElement("script");
    script.src = "/js/modules/daily-l300-runs.js";
    script.defer = true;
    script.dataset.gvModule = "daily-l300-runs";
    script.onerror = () => console.warn("GotaVita Daily L300 module failed to load.");
    document.head.appendChild(script);
  }

  function loadL300ReportingAdapter() {
    if (document.querySelector('script[data-gv-module="l300-reporting-adapter"]')) return;
    const script = document.createElement("script");
    script.src = "/js/modules/l300-reporting-adapter.js";
    script.defer = true;
    script.dataset.gvModule = "l300-reporting-adapter";
    script.onerror = () => console.warn("GotaVita L300 reporting adapter failed to load.");
    document.head.appendChild(script);
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("submit", function(event) {
      const target = event?.target;
      if (target?.id === "orderForm") reconcileOrderCounterBeforeCreate();
    }, { capture: true });
    document.addEventListener("DOMContentLoaded", function () {
      loadDailyL300Module();
      loadL300ReportingAdapter();
    }, { once: true });
  }
})();
