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

function withNoStore(response, content) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("pragma", "no-cache");
  return new Response(content, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function bustLocalScriptUrls(html, releaseSha) {
  const version = encodeURIComponent(String(releaseSha || "unknown").trim() || "unknown");
  let output = html.replace(
    /(<script\s+src=["'])(\/?(?:js\/|script\.js)[^"']*)(["'][^>]*>)/gi,
    (match, prefix, src, suffix) => {
      const clean = src.replace(/[?&]gv_release=[^&#]*/g, "");
      const separator = clean.includes("?") ? "&" : "?";
      return `${prefix}${clean}${separator}gv_release=${version}${suffix}`;
    }
  );

  // These two bridges must execute before script.js registers form listeners.
  // Durable cross-device convergence is handled by the authenticated polling
  // and reconciliation coordinator; Realtime is kept optional and is safely
  // shimmed so a websocket lifecycle failure cannot break writes.
  const marker = /<script\s+src=["'][^"']*js\/core\/sync-manager\.js[^"']*["'][^>]*><\/script>/i;
  const realtimeTag = `<script src="js/core/realtime-channel-lifecycle-fix.js?gv_release=${version}" defer></script>`;
  const bridgeTag = `<script src="js/core/order-write-boundary-bridge.js?gv_release=${version}" defer></script>`;

  if (!/realtime-channel-lifecycle-fix\.js(?:[?"'])/i.test(output)) {
    output = output.replace(marker, `${realtimeTag}\n$&`);
  }
  if (!/order-write-boundary-bridge\.js(?:[?"'])/i.test(output)) {
    output = output.replace(marker, `${bridgeTag}\n$&`);
  }

  return output;
}

async function serveApplicationAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("content-type") || "";
  const pathname = new URL(request.url).pathname;

  if (
    request.method !== "GET" ||
    !contentType.toLowerCase().includes("text/html")
  ) {
    if (/\.(?:js|css)$/i.test(pathname)) return withNoStore(response, response.body);
    return response;
  }

  const html = bustLocalScriptUrls(
    await response.text(),
    String(env.GV_RELEASE_SHA || "unknown").trim() || "unknown"
  );
  return withNoStore(response, html);
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
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      return configResponse(env);
    }

    return serveApplicationAsset(request, env);
  }
};
