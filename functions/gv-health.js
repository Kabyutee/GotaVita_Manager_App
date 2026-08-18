/**
 * GotaVita Manager — Cloudflare Pages production health check.
 * Exposes only non-secret deployment status.
 */
export async function onRequest({ env }) {
  const payload = {
    service: "gotavita-manager",
    status: "ok",
    supabaseConfigured: Boolean(String(env.SUPABASE_URL || "").trim()),
    publishableKeyConfigured: Boolean(String(env.SUPABASE_PUBLISHABLE_KEY || "").trim()),
    serverTime: new Date().toISOString()
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "x-content-type-options": "nosniff"
    }
  });
}
