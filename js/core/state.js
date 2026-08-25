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
      const rows = [...(Array.isArray(snapshot.orders) ? snapshot.orders : []), ...(Array.isArray(snapshot.deletedOrders) ? snapshot.deletedOrders : [])];
      let maxOrderNumber = Number(snapshot.orderCounter) || 0;
      for (const row of rows) maxOrderNumber = Math.max(maxOrderNumber, numericOrderNumber(row?.orderNumber));
      if (maxOrderNumber !== (Number(snapshot.orderCounter) || 0)) { snapshot.orderCounter = maxOrderNumber; window.replaceState(snapshot); }
    } catch (error) { console.warn("GotaVita order-number counter reconciliation skipped:", error?.message || error); }
  }
  async function hydrateAuthorizedStateAfterAuth() {
    try {
      if (window.GVAuth?.isAuthorized?.() !== true) return false;
      if (!window.GVData?.selectResource || !window.getStateSnapshot || !window.replaceState) return false;
      const resources = [["clients","clients"],["products","products"],["services","services"],["employees","employees"],["orders","orders"],["payments","payments"],["expenses","expenses"],["payroll_records","payrollRecords"],["order_groups","orderGroups"],["delivery_routes","deliveryRoutes"],["order_group_items","orderGroupItems"],["delivery_route_items","deliveryRouteItems"],["daily_reports","dailyReports"],["deleted_orders","deletedOrders"]];
      const next = window.getStateSnapshot(); let changed = false; const counts = {};
      for (const [resource,stateName] of resources) {
        try {
          const remoteRows = await window.GVData.selectResource(resource);
          const rows = Array.isArray(remoteRows) ? remoteRows : [];
          const localRows = Array.isArray(next?.[stateName]) ? next[stateName] : [];
          counts[resource] = rows.length;
          if (rows.length > 0 && (localRows.length === 0 || rows.length > localRows.length)) { next[stateName] = rows; changed = true; }
        } catch (error) { console.warn(`GotaVita ${resource} post-auth hydration skipped:`, error?.message || error); }
      }
      if (!changed) return false;
      const now = Date.now();
      next._meta = Object.assign({}, next._meta, { lastUpdated: now, lastSynchronizedAt: now, cloudHydratedAt: now, cloudHydrationVersion: 2, cloudHydrationCounts: counts });
      window.replaceState(next);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(next);
      if (typeof window.renderAll === "function") window.renderAll(); else if (window.GVUI?.renderAll) window.GVUI.renderAll();
      if (typeof window.renderDailyL300Runs === "function") window.renderDailyL300Runs();
      return true;
    } catch (error) { console.warn("GotaVita post-auth canonical hydration skipped:", error?.message || error); return false; }
  }
  function scheduleAuthorizedHydration() {
    if (window.GVAuth?.isAuthorized?.() !== true) return Promise.resolve(false);
    if (window.__GV_AUTH_HYDRATION_PROMISE) return window.__GV_AUTH_HYDRATION_PROMISE;
    const run = () => hydrateAuthorizedStateAfterAuth().finally(() => { window.__GV_AUTH_HYDRATION_PROMISE = null; });
    if (window.__GV_APP_READY === true) {
      window.__GV_AUTH_HYDRATION_PROMISE = run();
      return window.__GV_AUTH_HYDRATION_PROMISE;
    }
    window.__GV_AUTH_HYDRATION_PROMISE = new Promise(resolve => {
      window.addEventListener("gv-app-ready", () => resolve(run()), { once: true });
    });
    return window.__GV_AUTH_HYDRATION_PROMISE;
  }
  function ensureDailyL300Host() {
    if (typeof document === "undefined") return null;
    const existing = document.getElementById("dailyL300Runs"); if (existing) return existing;
    const dashboard = document.getElementById("panel-dashboard"); if (!dashboard) return null;
    const host = document.createElement("div"); host.id = "dailyL300Runs";
    const anchor = dashboard.querySelector(".dashboard-today-ops") || dashboard.querySelector(".dashboard-overview");
    if (anchor) anchor.insertAdjacentElement("beforebegin", host); else dashboard.prepend(host); return host;
  }

  window.GV_STATE=Object.freeze({createInitialState:function(){return {products:[],clients:[],services:[],orders:[],payments:[],expenses:[],payrollRecords:[],employees:[],orderGroups:[],deliveryRoutes:[],orderGroupItems:[],deliveryRouteItems:[],dailyReports:[],dailyRuns:[],deletedOrders:[],auditLog:[],orderCounter:138,_meta:{schemaVersion:3,lastUpdated:0,deviceId:""}};}});
  function loadScriptSequentially(src, markerName, markerValue, next) {
    const selector = `script[${markerName}="${markerValue}"]`;
    if (document.querySelector(selector) || document.querySelector(`script[src*="${src}"]`)) return next?.();
    const script = document.createElement("script"); script.src = src; script.defer = false; script.setAttribute(markerName, markerValue);
    script.onload = () => next?.(); script.onerror = () => console.warn(`GotaVita module failed to load: ${src}`); document.head.appendChild(script);
  }
  function loadDailyL300Module() { ensureDailyL300Host(); loadScriptSequentially("/js/modules/daily-l300-runs.js", "data-gv-module", "daily-l300-runs"); }
  function loadCanonicalSyncRuntime() {
    if (document.querySelector('script[data-gv-runtime-sync-loader="true"]')) return;
    const script = document.createElement("script"); script.src = "/js/core/sync-runtime-activation.js"; script.defer = false; script.dataset.gvRuntimeSyncLoader = "true";
    script.onerror = () => console.warn("GotaVita canonical sync runtime activation failed to load."); document.head.appendChild(script);
  }
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("submit", function(event){ if(event?.target?.id === "orderForm") reconcileOrderCounterBeforeCreate(); }, {capture:true});
    window.addEventListener("gv-auth-state-changed", function(event){ if(event?.detail?.authenticated === true) scheduleAuthorizedHydration(); });
    document.addEventListener("DOMContentLoaded", function(){ ensureDailyL300Host(); loadDailyL300Module(); loadCanonicalSyncRuntime(); scheduleAuthorizedHydration(); try{window.GVSync?.stopPolling?.();}catch(_){} }, {once:true});
  }

  const originalAddEventListener = window.addEventListener.bind(window);
  const originalRemoveEventListener = window.removeEventListener.bind(window);
  const deferredAuthListeners = [];
  let appReady = false;
  let releasePromise = null;
  let pendingDomReadyHandlers = 0;
  window.__GV_APP_READY = false;

  function rememberAuthListener(listener, options){ deferredAuthListeners.push({listener,options}); }
  function dispatchCurrentAuthState(){
    const authenticated = window.GVAuth?.isAuthorized?.() === true;
    const event = new CustomEvent("gv-auth-state-changed", {detail:{authenticated}});
    for(const {listener} of deferredAuthListeners.splice(0)){
      try{ if(typeof listener === "function") listener.call(window,event); else if(listener && typeof listener.handleEvent === "function") listener.handleEvent(event); }
      catch(error){ console.warn("GotaVita deferred auth listener:",error?.message||error); }
    }
  }
  function injectLifecycleGuard(){
    if(window.GVApplicationLifecycleGuard?.install){ window.GVApplicationLifecycleGuard.install(); return Promise.resolve(); }
    return new Promise((resolve,reject)=>{
      const src="/js/core/application-lifecycle-guard.js?gv_lifecycle=1";
      const existing=document.querySelector('script[data-gv-app-lifecycle="true"]');
      if(existing){ existing.addEventListener("load",()=>{try{window.GVApplicationLifecycleGuard?.install?.();resolve();}catch(error){reject(error);}}, {once:true}); existing.addEventListener("error",reject,{once:true}); return; }
      const script=document.createElement("script"); script.src=src; script.defer=false; script.dataset.gvAppLifecycle="true";
      script.onload=()=>{try{window.GVApplicationLifecycleGuard?.install?.();resolve();}catch(error){reject(error);}};
      script.onerror=()=>reject(new Error("Application lifecycle guard failed to load.")); (document.head||document.documentElement).appendChild(script);
    });
  }
  function maybeReleaseAppReady(){
    if(appReady || pendingDomReadyHandlers !== 0) return;
    if(typeof document !== "undefined" && document.readyState === "loading") return;
    appReady = true; window.__GV_APP_READY = true;
    window.dispatchEvent(new CustomEvent("gv-app-ready")); dispatchCurrentAuthState();
    try{window.GVSync?.startPolling?.();}catch(_){}
  }
  function gateDomReadyListener(listener, options){
    pendingDomReadyHandlers += 1;
    originalAddEventListener("DOMContentLoaded", async function gatedDomReady(event){
      if(!releasePromise) releasePromise = injectLifecycleGuard();
      try{ await releasePromise; const result=listener.call(window,event); if(result&&typeof result.then === "function") await result; }
      catch(error){ console.warn("GotaVita gated DOMContentLoaded listener:",error?.message||error); }
      finally{ pendingDomReadyHandlers -= 1; maybeReleaseAppReady(); }
    }, options);
  }
  if(!window.__GV_APPLICATION_LIFECYCLE_PATCHED){
    window.addEventListener=function(type,listener,options){
      if(type === "gv-auth-state-changed" && !appReady){ rememberAuthListener(listener,options); return; }
      if(type === "DOMContentLoaded" && typeof listener === "function" && !appReady){ gateDomReadyListener(listener,options); return; }
      return originalAddEventListener(type,listener,options);
    };
    window.removeEventListener=function(type,listener,options){
      if(type === "gv-auth-state-changed" && !appReady){ for(let i=deferredAuthListeners.length-1;i>=0;i--) if(deferredAuthListeners[i].listener === listener) deferredAuthListeners.splice(i,1); return; }
      return originalRemoveEventListener(type,listener,options);
    };
    window.__GV_APPLICATION_LIFECYCLE_PATCHED = true;
  }
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("DOMContentLoaded", maybeReleaseAppReady, {once:true});
    if (document.readyState !== "loading") maybeReleaseAppReady();
  }
})();
