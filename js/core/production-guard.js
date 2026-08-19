/* GotaVita Manager — Phase 5 Sprint 6 Step 5
 * Production deployment guard and diagnostics. Never exposes secrets.
 * Sprint 12 — conflict detection helper. Detection only; no automatic resolver.
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

  function parseTime(value) {
    if (value == null || value === "") return null;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }

  function rowKey(row) {
    if (!row || typeof row !== "object") return null;
    const candidates = [row.id, row.legacyId, row.legacy_id, row.supabaseId, row.supabase_id];
    for (const value of candidates) {
      if (value != null && String(value).trim() !== "") return String(value).trim();
    }
    return null;
  }

  function rowUpdatedAt(row) {
    if (!row || typeof row !== "object") return null;
    return parseTime(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at);
  }

  function detect(localRows, remoteRows, baselineAt) {
    const baseline = parseTime(baselineAt);
    const local = Array.isArray(localRows) ? localRows : [];
    const remote = Array.isArray(remoteRows) ? remoteRows : [];
    const remoteByKey = new Map();

    for (const row of remote) {
      const key = rowKey(row);
      if (key != null) remoteByKey.set(key, row);
    }

    const conflicts = [];
    const indeterminate = [];

    for (const localRow of local) {
      const key = rowKey(localRow);
      if (key == null) continue;

      const remoteRow = remoteByKey.get(key);
      if (!remoteRow) continue;

      const localUpdated = rowUpdatedAt(localRow);
      const remoteUpdated = rowUpdatedAt(remoteRow);

      if (baseline == null || localUpdated == null || remoteUpdated == null) {
        indeterminate.push({
          key,
          reason: "missing-baseline-or-timestamp",
          localUpdatedAt: localUpdated == null ? null : new Date(localUpdated).toISOString(),
          remoteUpdatedAt: remoteUpdated == null ? null : new Date(remoteUpdated).toISOString()
        });
        continue;
      }

      const localChanged = localUpdated > baseline;
      const remoteChanged = remoteUpdated > baseline;

      if (localChanged && remoteChanged && localUpdated !== remoteUpdated) {
        conflicts.push({
          key,
          baselineAt: new Date(baseline).toISOString(),
          localUpdatedAt: new Date(localUpdated).toISOString(),
          remoteUpdatedAt: new Date(remoteUpdated).toISOString(),
          preferredObservation: remoteUpdated > localUpdated ? "remote-newer" : "local-newer"
        });
      }
    }

    return {
      conflictCount: conflicts.length,
      indeterminateCount: indeterminate.length,
      conflicts,
      indeterminate
    };
  }

  function run() {
    const result = diagnostics();
    try { localStorage.setItem("gotavita_production_guard_last", JSON.stringify({ at: new Date().toISOString(), ok: result.ok, checks: result.checks })); } catch (_) {}
    return result;
  }

  window.GVConflictDetector = Object.freeze({
    detect,
    rowKey,
    rowUpdatedAt,
    parseTime
  });

  window.GVProductionGuard = Object.freeze({ diagnostics, run, isLocal, cloudConfigured });
  window.addEventListener("load", () => { try { run(); } catch (_) {} }, { once: true });
})();
