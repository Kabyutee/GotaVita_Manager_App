/* GotaVita Manager — production diagnostics and pure conflict policy boundary. */
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
    const missing = REQUIRED_IDS.filter((id) => !document.getElementById(id));
    const checks = [
      ["HTTPS", isHttps() || isLocal(), isLocal() ? "Local development" : (isHttps() ? "Secure connection" : "Production must use HTTPS")],
      ["Cloud configuration", cloudConfigured() || isLocal(), cloudConfigured() ? "Supabase publishable configuration detected" : (isLocal() ? "Local mode" : "Supabase configuration missing")],
      ["No secret key in browser config", !/service[_-]?role|secret/i.test(String(config().publishableKey || "")), "Browser must never receive a service-role/secret key"],
      ["Core UI controls", missing.length === 0, missing.length ? `Missing: ${missing.join(", ")}` : "Required controls present"],
      ["Local storage", (() => { try { const k = "gv_prod_guard_probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (_) { return false; } })(), "Writable browser storage"],
      ["Connectivity", navigator.onLine, navigator.onLine === false ? "Offline; local-first mode remains available" : "Online"]
    ];
    return { ok: checks.every((x) => x[1]), checks };
  }

  function parseTime(value) {
    if (value == null || value === "") return null;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }

  function rowKey(row) {
    if (!row || typeof row !== "object") return null;
    for (const value of [row.id, row.legacyId, row.legacy_id, row.supabaseId, row.supabase_id]) {
      if (value != null && String(value).trim() !== "") return String(value).trim();
    }
    return null;
  }

  function rowUpdatedAt(row) {
    if (!row || typeof row !== "object") return null;
    return parseTime(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at);
  }

  function rowDeletedAt(row) {
    if (!row || typeof row !== "object") return null;
    return parseTime(row.deletedAt ?? row.deleted_at ?? row.archivedAt ?? row.archived_at);
  }

  function isDeleted(row) {
    if (!row || typeof row !== "object") return false;
    return row.deleted === true || row.isDeleted === true || row.is_deleted === true || row.deletedAt != null || row.deleted_at != null || row.archivedAt != null || row.archived_at != null;
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
        indeterminate.push({ key, reason: "missing-baseline-or-timestamp" });
        continue;
      }
      const localChanged = localUpdated > baseline;
      const remoteChanged = remoteUpdated > baseline;
      if (localChanged && remoteChanged && localUpdated !== remoteUpdated) {
        conflicts.push({ key, baselineAt: new Date(baseline).toISOString(), localUpdatedAt: new Date(localUpdated).toISOString(), remoteUpdatedAt: new Date(remoteUpdated).toISOString(), preferredObservation: remoteUpdated > localUpdated ? "remote-newer" : "local-newer" });
      }
    }
    return { conflictCount: conflicts.length, indeterminateCount: indeterminate.length, conflicts, indeterminate };
  }

  function resolveConflictPolicy(localRow, remoteRow, baselineAt) {
    const baseline = parseTime(baselineAt);
    const localUpdated = rowUpdatedAt(localRow);
    const remoteUpdated = rowUpdatedAt(remoteRow);
    const localDeleted = isDeleted(localRow);
    const remoteDeleted = isDeleted(remoteRow);
    const localDeletedAt = rowDeletedAt(localRow);
    const remoteDeletedAt = rowDeletedAt(remoteRow);

    if (baseline == null || localUpdated == null || remoteUpdated == null) {
      return { action: "manual-review", reason: "indeterminate", mutation: false };
    }

    if (localDeleted !== remoteDeleted) {
      if (localDeletedAt != null && remoteUpdated != null && localDeletedAt > remoteUpdated) return { action: "keep-local", reason: "local-deletion-newer", mutation: false };
      if (remoteDeletedAt != null && localUpdated != null && remoteDeletedAt > localUpdated) return { action: "keep-remote", reason: "remote-deletion-newer", mutation: false };
      return { action: "manual-review", reason: "deletion-vs-update-ambiguous", mutation: false };
    }

    const localChanged = localUpdated > baseline;
    const remoteChanged = remoteUpdated > baseline;
    if (!localChanged && !remoteChanged) return { action: "no-conflict", reason: "unchanged-since-baseline", mutation: false };
    if (localChanged && !remoteChanged) return { action: "keep-local", reason: "local-only-change", mutation: false };
    if (remoteChanged && !localChanged) return { action: "keep-remote", reason: "remote-only-change", mutation: false };
    if (localUpdated > remoteUpdated) return { action: "keep-local", reason: "local-newer", mutation: false };
    if (remoteUpdated > localUpdated) return { action: "keep-remote", reason: "remote-newer", mutation: false };
    return { action: "manual-review", reason: "same-timestamp", mutation: false };
  }

  function run() {
    const result = diagnostics();
    try { localStorage.setItem("gotavita_production_guard_last", JSON.stringify({ at: new Date().toISOString(), ok: result.ok, checks: result.checks })); } catch (_) {}
    return result;
  }

  window.GVConflictDetector = Object.freeze({ detect, resolveConflictPolicy, rowKey, rowUpdatedAt, rowDeletedAt, isDeleted, parseTime });
  window.GVProductionGuard = Object.freeze({ diagnostics, run, isLocal, cloudConfigured });
  window.addEventListener("load", () => { try { run(); } catch (_) {} }, { once: true });
})();
