/* GotaVita Manager — Phase 5 Sprint 6
 * Supabase browser-safe configuration.
 *
 * Production:
 *   Cloudflare Worker injects GV_PUBLIC_CONFIG through /gv-config.
 *
 * Local development:
 *   LOCAL_SUPABASE_URL and LOCAL_SUPABASE_PUBLISHABLE_KEY
 *   provide a browser-safe fallback.
 *
 * NEVER place a Supabase service-role/secret key here.
 */

(function () {
  "use strict";

  const injected = window.GV_PUBLIC_CONFIG || {};
  const legacy = window.GV_SUPABASE_CONFIG || {};

  /*
   * LOCAL DEVELOPMENT FALLBACK
   *
   * Replace the two empty strings below with:
   * 1. Your Supabase Project URL
   * 2. Your Supabase Publishable/Anon key
   *
   * These values are safe for browser use.
   */
  const LOCAL_SUPABASE_URL = "https://gytzvcwlyeeszxwjteir.supabase.co";

  const LOCAL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kigXIYUXju9wio-_gURlxw_rZ7KVUnL";

  window.GV_SUPABASE_CONFIG = Object.freeze({
    url: String(
      injected.supabaseUrl ||
      legacy.url ||
      LOCAL_SUPABASE_URL ||
      ""
    ).trim(),

    publishableKey: String(
      injected.supabasePublishableKey ||
      legacy.publishableKey ||
      LOCAL_SUPABASE_PUBLISHABLE_KEY ||
      ""
    ).trim()
  });
})();