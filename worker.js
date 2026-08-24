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
  const pathname = new URL(request.url).pathname;

  // Canonical payload authority hotfix. data-gateway historically merged
  // legacy_payload AFTER the normalized Supabase columns, allowing stale
  // historical values to overwrite a successful cloud edit during hydration.
  // Fix the response at the Worker boundary while the source-level repair
  // branch is being gated, so production can never read that stale precedence.
  if (
    request.method === "GET" &&
    /\/js\/core\/data-gateway\.js$/i.test(pathname) &&
    contentType.toLowerCase().includes("javascript")
  ) {
    const source = await response.text();
    const repaired = source.replace(
      /function mergePayload\(\s*original,\s*payload\s*\)\s*\{\s*return \{\s*\.\.\.\(payload \|\| \{\}\),\s*\.\.\.\(\s*original &&\s*typeof original === [\"']object[\"']\s*\? original\s*:\s*\{\}\s*\)\s*\};\s*\}/m,
      `function mergePayload(original, payload) {\n    // legacy_payload is compatibility history; canonical Supabase columns win.\n    return {\n      ...(original && typeof original === "object" ? original : {}),\n      ...(payload || {})\n    };\n  }`
    );

    return withNoStore(response, repaired);
  }

  if (
    request.method !== "GET" ||
    !contentType.toLowerCase().includes("text/html")
  ) {
    if (/\.(?:js|css)$/i.test(pathname)) {
      return withNoStore(response, response.body);
    }
    return response;
  }

  let html = await response.text();
  const releaseSha = String(env.GV_RELEASE_SHA || "unknown").trim() || "unknown";

  // Version all application-owned scripts so a new Worker release cannot be
  // paired with an older browser-cached synchronization stack.
  html = bustLocalScriptUrls(html, releaseSha);

  // The cloud snapshot safety gate must execute before sync-manager.js starts
  // its immediate five-second polling cycle. This is a fail-closed boundary:
  // a sudden empty/sharply reduced cloud snapshot cannot enter reconciliation.
  const syncManagerMarker = `<script src="js/core/sync-manager.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const safetyGuardInjected = `<script src="/js/core/sync-cloud-snapshot-safety.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(syncManagerMarker) && !html.includes(safetyGuardInjected)) {
    html = html.replace(syncManagerMarker, `${safetyGuardInjected}\n${syncManagerMarker}`);
  }

  // The reconciler must be loaded before ui-bridge captures GVData as its
  // immutable original gateway. This makes every subsequent cross-device
  // upsert pass through order-level write reconciliation.
  const bridgeMarker = `<script src="js/core/ui-bridge.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const reconcilerInjected = `<script src="/js/core/sync-cloud-write-reconciler.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
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

  const repairMarker = `<script src="js/core/group-membership-sync-bridge.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const repairInjected = `<script src="/js/core/sync-complete-runtime-repair.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(repairMarker) && !html.includes(repairInjected)) {
    html = html.replace(repairMarker, `${repairMarker}\n${repairInjected}`);
  }

  // Final P0 canonical boundary: this must execute after every earlier sync
  // repair so a conflict/manual-review decision cannot leave a receiving
  // browser showing a stale Client/Employee/Product row.
  const p0Marker = `<script src="/js/core/sync-complete-runtime-repair.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  const p0Injected = `<script src="/js/core/sync-p0-final-canonicalizer.js?gv_release=${encodeURIComponent(releaseSha)}" defer></script>`;
  if (html.includes(p0Marker) && !html.includes(p0Injected)) {
    html = html.replace(p0Marker, `${p0Marker}\n${p0Injected}`);
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

    if (url.pathname === "/api/data" || url.pathname.startsWith("/api/")) {
      return jsonResponse({
        error: "Legacy server API is not part of the production Worker.",
        code: "LEGACY_API_RETIRED"
      }, 410);
    }

    return serveApplicationAsset(request, env);
  }
};
