/* GotaVita Manager — Phase 5 Sprint 5 public Supabase configuration
 * Browser-safe values only. Cloudflare Pages injects these through /gv-config.
 * Never place a Supabase secret/service-role key in this file.
 */
(function () {
  "use strict";
  const injected = window.GV_PUBLIC_CONFIG || {};
  const legacy = window.GV_SUPABASE_CONFIG || {};
  window.GV_SUPABASE_CONFIG = Object.freeze({
    url: String(injected.supabaseUrl || legacy.url || "").trim(),
    publishableKey: String(injected.supabasePublishableKey || legacy.publishableKey || "").trim()
  });
})();
