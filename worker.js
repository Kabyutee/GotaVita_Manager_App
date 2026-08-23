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
  return html.replace(
    /(<script\s+src=["'])(\/?(?:js\/|script\.js)[^"']*)(["'][^>]*>)/gi,
    (match, prefix, src, suffix) => {
      const clean = src.replace(/[?&]gv_release=[^&#]*/g, "");
      const separator = clean.includes("?") ? "&" : "?";
      return `${prefix}${clean}${separator}gv_release=${version}${suffix}`;
    }
  );
}

async function serveApplicationAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("content-type") || "";

  if (
    request.method !== "GET" ||
    !contentType.toLowerCase().includes("text/html")
  ) {
    if (/\.(?:js|css)$/i.test(new URL(request.url).pathname)) {
      return withNoStore(response, response.body);
    }
    return response;
  }

  let html = await response.text();
  const releaseSha = String(env.GV_RELEASE_SHA || "unknown").trim() || "unknown";

  // Version all application-owned scripts so a new Worker release cannot be
  // paired with an older browser-cached synchronization stack.
  html = bustLocalScriptUrls(html, releaseSha);

  // The reconciler must be loaded before ui-bridge captures GVData as its
  // immutable original gateway. This makes every subsequent cross-device
  // upsert pass through order-level write reconciliation.
  const bridgeMarker = `<script src="js/core/ui-bridge.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const reconcilerInjected = `<script src="js/core/sync-cloud-write-reconciler.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(bridgeMarker) && !html.includes(reconcilerInjected)) {
    html = html.replace(bridgeMarker, `${reconcilerInjected}\n${bridgeMarker}`);
  }

  const queueAuthorityInjected = `<script src="/js/core/sync-queue-authority.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(bridgeMarker) && !html.includes(queueAuthorityInjected)) {
    html = html.replace(bridgeMarker, `${bridgeMarker}\n${queueAuthorityInjected}`);
  }

  const authorityMarker = `<script src="script.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const authorityInjected = `<script src="/js/core/sync-authority.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(authorityMarker) && !html.includes(authorityInjected)) {
    html = html.replace(authorityMarker, `${authorityMarker}\n${authorityInjected}`);
  }

  // The auth bridge runs after script.js so Supabase session validation has a
  // chance to complete before GVSync's first polling cycle. This prevents the
  // Incognito startup race where GVSync observes a stale authorized=false flag
  // and exits before ever reaching GVData.sync().
  const authBridgeMarker = `<script src="/js/core/sync-authority.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const authBridgeInjected = `<script src="/js/core/sync-auth-startup-bridge.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(authBridgeMarker) && !html.includes(authBridgeInjected)) {
    html = html.replace(authBridgeMarker, `${authBridgeMarker}\n${authBridgeInjected}`);
  }

  const groupMembershipMarker = `<script src="/js/core/sync-auth-startup-bridge.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const groupMembershipInjected = `<script src="/js/core/group-membership-sync-bridge.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(groupMembershipMarker) && !html.includes(groupMembershipInjected)) {
    html = html.replace(groupMembershipMarker, `${groupMembershipMarker}\n${groupMembershipInjected}`);
  }

  // Final convergence boundary: after the canonical sync stack is active,
  // reconcile both directions against the authoritative Supabase snapshot.
  const repairMarker = `<script src="/js/core/group-membership-sync-bridge.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const repairInjected = `<script src="/js/core/sync-complete-runtime-repair.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(repairMarker) && !html.includes(repairInjected)) {
    html = html.replace(repairMarker, `${repairMarker}\n${repairInjected}`);
  }

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
