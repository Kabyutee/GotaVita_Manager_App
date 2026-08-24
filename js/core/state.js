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
      for (const row of rows) maxOrderNumber = Math.max(maxOrderNumber, numericOrderNumber(row?.orderNumber));
      if (maxOrderNumber !== (Number(snapshot.orderCounter) || 0)) {
        snapshot.orderCounter = maxOrderNumber;
        window.replaceState(snapshot);
      }
    } catch (error) {
      console.warn("GotaVita order-number counter reconciliation skipped:", error?.message || error);
    }
  }

  async function hydrateAuthorizedStateAfterAuth() {
    try {
      if (window.GVAuth?.isAuthorized?.() !== true) return false;
      if (!window.GVData?.selectResource || !window.getStateSnapshot || !window.replaceState) return false;

      const resources = [
        ["clients", "clients"],
        ["products", "products"],
        ["services", "services"],
        ["employees", "employees"],
        ["orders", "orders"],
        ["payments", "payments"],
        ["expenses", "expenses"],
        ["payroll_records", "payrollRecords"],
        ["order_groups", "orderGroups"],
        ["delivery_routes", "deliveryRoutes"],
        ["order_group_items", "orderGroupItems"],
        ["delivery_route_items", "deliveryRouteItems"],
        ["daily_reports", "dailyReports"],
        ["deleted_orders", "deletedOrders"]
      ];

      const next = window.getStateSnapshot();
      let changed = false;
      const counts = {};

      for (const [resource, stateName] of resources) {
        try {
          const remoteRows = await window.GVData.selectResource(resource);
          const rows = Array.isArray(remoteRows) ? remoteRows : [];
          const localRows = Array.isArray(next?.[stateName]) ? next[stateName] : [];
          counts[resource] = rows.length;

          // Retained only as an explicit utility for diagnostics/compatibility.
          // Automatic startup hydration is owned by GVSync.flush() so local state
          // is restored before the canonical Supabase reconciliation runs.
          if (rows.length > 0 && (localRows.length === 0 || rows.length > localRows.length)) {
            next[stateName] = rows;
            changed = true;
          }
        } catch (error) {
          console.warn(`GotaVita ${resource} post-auth hydration skipped:`, error?.message || error);
        }
      }

      if (!changed) return false;

      const now = Date.now();
      next._meta = Object.assign({}, next._meta, {
        lastUpdated: now,
        lastSynchronizedAt: now,
        cloudHydratedAt: now,
        cloudHydrationVersion: 2,
        cloudHydrationCounts: counts
      });

      window.replaceState(next);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(next);
      if (typeof window.renderAll === "function") window.renderAll();
      else if (window.GVUI?.renderAll) window.GVUI.renderAll();
      if (typeof window.renderDailyL300Runs === "function") window.renderDailyL300Runs();
      return true;
    } catch (error) {
      console.warn("GotaVita post-auth canonical hydration skipped:", error?.message || error);
      return false;
    }
  }

  function scheduleAuthorizedHydration() {
    // Intentionally not automatic. GVSync.flush() is the sole startup
    // synchronization authority after local state has been restored.
    return false;
  }

  function ensureDailyL300Host() {
    if (typeof document === "undefined") return null;
    const existing = document.getElementById("dailyL300Runs");
    if (existing) return existing;
    const dashboard = document.getElementById("panel-dashboard");
    if (!dashboard) return null;
    const host = document.createElement("div");
    host.id = "dailyL300Runs";
    const anchor = dashboard.querySelector(".dashboard-today-ops") || dashboard.querySelector(".dashboard-overview");
    if (anchor) anchor.insertAdjacentElement("beforebegin", host);
    else dashboard.prepend(host);
    return host;
  }

  window.GV_STATE=Object.freeze({createInitialState:function(){return {products:[],clients:[],services:[],orders:[],payments:[],expenses:[],payrollRecords:[],employees:[],orderGroups:[],deliveryRoutes:[],orderGroupItems:[],deliveryRouteItems:[],dailyReports:[],dailyRuns:[],deletedOrders:[],auditLog:[],orderCounter:138,_meta:{schemaVersion:3,lastUpdated:0,deviceId:""}};}});

  function loadScriptSequentially(src, markerName, markerValue, next) {
    const selector = `script[${markerName}="${markerValue}"]`;
    if (document.querySelector(selector) || document.querySelector(`script[src*="${src}"]`)) return next?.();
    const script = document.createElement("script");
    script.src = src;
    script.defer = false;
    script.setAttribute(markerName, markerValue);
    script.onload = () => next?.();
    script.onerror = () => console.warn(`GotaVita module failed to load: ${src}`);
    document.head.appendChild(script);
  }

  function loadDailyL300Module() {
    ensureDailyL300Host();
    loadScriptSequentially("/js/modules/daily-l300-runs.js", "data-gv-module", "daily-l300-runs");
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
      ensureDailyL300Host();
      loadDailyL300Module();
      loadCanonicalSyncRuntime();
    }, { once: true });
  }
})();
