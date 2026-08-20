/**
 * GotaVita Manager — Cloudflare Workers Static Assets entry point.
 * Serves the static application and exposes the two production endpoints
 * that were previously defined as Cloudflare Pages Functions.
 */

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "x-content-type-options": "nosniff"
    }
  });
}

function configResponse(env) {
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

function healthResponse(env) {
  return jsonResponse({
    service: "gotavita-manager",
    status: "ok",
    releaseSha: String(env.GV_RELEASE_SHA || "unknown").trim() || "unknown",
    supabaseConfigured: Boolean(String(env.SUPABASE_URL || "").trim()),
    publishableKeyConfigured: Boolean(String(env.SUPABASE_PUBLISHABLE_KEY || "").trim()),
    serverTime: new Date().toISOString()
  });
}

async function serveApplicationAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("content-type") || "";

  if (
    request.method !== "GET" ||
    !contentType.toLowerCase().includes("text/html")
  ) {
    return response;
  }

  let html = await response.text();

  // The reconciler must be loaded before ui-bridge captures GVData as its
  // immutable original gateway. This makes every subsequent cross-device
  // upsert pass through order-level write reconciliation.
  const bridgeMarker = '<script src="js/core/ui-bridge.js" defer></script>';
  const reconcilerInjected = '<script src="js/core/sync-cloud-write-reconciler.js" defer></script>';
  if (html.includes(bridgeMarker) && !html.includes(reconcilerInjected)) {
    html = html.replace(bridgeMarker, `${reconcilerInjected}\n${bridgeMarker}`);
  }

  const authorityMarker = '<script src="script.js" defer></script>';
  const authorityInjected = '<script src="/js/core/sync-authority.js" defer></script>';
  if (html.includes(authorityMarker) && !html.includes(authorityInjected)) {
    html = html.replace(authorityMarker, `${authorityMarker}\n${authorityInjected}`);
  }

  // The auth bridge runs after script.js so Supabase session validation has a
  // chance to complete before GVSync's first polling cycle. This prevents the
  // Incognito startup race where GVSync observes a stale authorized=false flag
  // and exits before ever reaching GVData.sync().
  const authBridgeMarker = '<script src="/js/core/sync-authority.js" defer></script>';
  const authBridgeInjected = '<script src="/js/core/sync-auth-startup-bridge.js" defer></script>';
  if (html.includes(authBridgeMarker) && !html.includes(authBridgeInjected)) {
    html = html.replace(authBridgeMarker, `${authBridgeMarker}\n${authBridgeInjected}`);
  }

  return new Response(html, response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/gv-health") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return healthResponse(env);
    }

    if (url.pathname === "/gv-config") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return configResponse(env);
    }

    // Legacy Node/JSON server API is intentionally retired in the Cloudflare
    // + Supabase production architecture. Return an explicit 410 so browser
    // diagnostics are clear instead of surfacing a platform 500.
    if (url.pathname === "/api/data" || url.pathname.startsWith("/api/")) {
      return jsonResponse({
        error: "Legacy server API is not part of the production Worker.",
        code: "LEGACY_API_RETIRED"
      }, 410);
    }

    return serveApplicationAsset(request, env);
  }
};
