/**
 * GotaVita Manager — Cloudflare Pages public runtime configuration.
 * Exposes ONLY the browser-safe Supabase URL and publishable key.
 * Never expose server-only Supabase credentials here.
 */
export async function onRequest({ env }) {
  const body = `window.GV_PUBLIC_CONFIG=${JSON.stringify({
    supabaseUrl: String(env.SUPABASE_URL || "").trim(),
    supabasePublishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || "").trim()
  })};`;
  return new Response(body, {
    headers: {
      "content-type": "application/javascript; charset=UTF-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "x-content-type-options": "nosniff"
    }
  });
}
