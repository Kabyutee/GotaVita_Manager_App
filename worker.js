/**
 * GotaVita Manager — Cloudflare Workers static asset entry point.
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

function withNoStore(response, content = null) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("pragma", "no-cache");
  if (content === null) return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  return new Response(content, { status: response.status, statusText: response.statusText, headers });
}

function bustLocalScriptUrls(html, releaseSha) {
  const version = encodeURIComponent(String(releaseSha || "unknown").trim() || "unknown");
  return html.replace(
    /(<script\s+src=["'])(\/?(?:js\/|script\.js)[^"']*)(["'][^>]*>)/gi,
    (match, prefix, src, suffix) => {
      const clean = src.replace(/[?&]gv_release=[^&#]*/g, "");
      const separator = clean.includes("?") ? "&" : "?";
      return `${prefix}${clean}${separator}gv_release=${version}${suffix}`;
    }
  );
}

function injectSafetyGuard(html, releaseSha) {
  const version = encodeURIComponent(String(releaseSha || "unknown").trim() || "unknown");
  const tag = `<script src="/js/core/destructive-safety-guard.js?gv_release=${version}" defer></script>`;
  return html.includes("destructive-safety-guard.js") ? html : html.replace(/<\/head>/i, `${tag}</head>`);
}

async function serveApplicationAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("content-type") || "";

  if (request.method === "GET" && contentType.toLowerCase().includes("text/html")) {
    const html = await response.text();
    const releaseSha = String(env.GV_RELEASE_SHA || "unknown").trim() || "unknown";
    return withNoStore(response, injectSafetyGuard(bustLocalScriptUrls(html, releaseSha), releaseSha));
  }

  if (request.method === "GET" || request.method === "HEAD") return withNoStore(response);
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/gv-health") {
      if (request.method !== "GET" && request.method !== "HEAD") return jsonResponse({ error: "Method not allowed" }, 405);
      return healthResponse(env);
    }

    if (url.pathname === "/gv-config") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
      return configResponse(env);
    }

    if (url.pathname === "/api/data" || url.pathname.startsWith("/api/")) {
      return jsonResponse({
        error: "Legacy server API is not part of the production Worker.",
        code: "LEGACY_API_RETIRED"
      }, 410);
    }

    return serveApplicationAsset(request, env);
  }
};
