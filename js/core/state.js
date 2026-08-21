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

  window.GV_STATE=Object.freeze({createInitialState:function(){return {products:[],clients:[],services:[],orders:[],payments:[],expenses:[],payrollRecords:[],employees:[],orderGroups:[],deliveryRoutes:[],orderGroupItems:[],deliveryRouteItems:[],dailyReports:[],deletedOrders:[],auditLog:[],orderCounter:138,_meta:{schemaVersion:3,lastUpdated:0,deviceId:""}};}});

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("submit", function(event) {
      const target = event?.target;
      if (target?.id === "orderForm") reconcileOrderCounterBeforeCreate();
    }, { capture: true });
  }
})();
