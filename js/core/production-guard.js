/* GotaVita Manager — Phase 5 Sprint 6 Step 5
 * Production deployment guard and diagnostics. Never exposes secrets.
 */
(function () {
  "use strict";
  const REQUIRED_IDS = ["syncStatus", "syncNowBtn", "gvCloudLoginBtn", "gvCloudLogoutBtn"];

  function config() { return window.GV_SUPABASE_CONFIG || {}; }
  function isHttps() { return location.protocol === "https:"; }
  function isLocal() { return location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/i.test(location.hostname); }
  function cloudConfigured() {
    const c = config();
    return !!c.url && !!c.publishableKey && !/service[_-]?role|secret/i.test(String(c.publishableKey || ""));
  }
  function diagnostics() {
    const missing = REQUIRED_IDS.filter(id => !document.getElementById(id));
    const checks = [
      ["HTTPS", isHttps() || isLocal(), isLocal() ? "Local development" : (isHttps() ? "Secure connection" : "Production must use HTTPS")],
      ["Cloud configuration", cloudConfigured() || isLocal(), cloudConfigured() ? "Supabase publishable configuration detected" : (isLocal() ? "Local mode" : "Supabase configuration missing")],
      ["No secret key in browser config", !/service[_-]?role|secret/i.test(String(config().publishableKey || "")), "Browser must never receive a service-role/secret key"],
      ["Core UI controls", missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : "Required controls present"],
      ["Local storage", (() => { try { const k="gv_prod_guard_probe"; localStorage.setItem(k,"1"); localStorage.removeItem(k); return true; } catch (_) { return false; } })(), "Writable browser storage"],
      ["Connectivity", navigator.onLine !== false, navigator.onLine === false ? "Offline; local-first mode remains available" : "Online"]
    ];
    return { ok: checks.every(x => x[1]), checks };
  }
  function run() {
    const result = diagnostics();
    try { localStorage.setItem("gotavita_production_guard_last", JSON.stringify({ at: new Date().toISOString(), ok: result.ok, checks: result.checks })); } catch (_) {}
    return result;
  }
  window.GVProductionGuard = Object.freeze({ diagnostics, run, isLocal, cloudConfigured });
  window.addEventListener("load", () => { try { run(); } catch (_) {} }, { once: true });
})();
