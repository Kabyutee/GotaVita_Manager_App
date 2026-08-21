/* GotaVita Manager — Phase 5 Sprint 6 Step 5
 * Production deployment guard and diagnostics. Never exposes secrets.
 * Sprint 12 — conflict detection + side-effect-free resolution policy.
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

  function rowDeletedAt(row) {
    if (!row || typeof row !== "object") return null;
    return parseTime(row.deletedAt ?? row.deleted_at ?? row.archivedAt ?? row.archived_at) ?? null;
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
      if (localDeletedAt != null && remoteUpdated != null && localDeletedAt > remoteUpdated) {
        return { action: "keep-local", reason: "local-deletion-newer", mutation: false };
      }
      if (remoteDeletedAt != null && localUpdated != null && remoteDeletedAt > localUpdated) {
        return { action: "keep-remote", reason: "remote-deletion-newer", mutation: false };
      }
      return { action: "manual-review", reason: "deletion-vs-update-ambiguous", mutation: false };
    }

    const localChanged = localUpdated > baseline;
    const remoteChanged = remoteUpdated > baseline;

    if (!localChanged && !remoteChanged) {
      return { action: "no-conflict", reason: "unchanged-since-baseline", mutation: false };
    }

    if (localChanged && !remoteChanged) {
      return { action: "keep-local", reason: "local-only-change", mutation: false };
    }

    if (remoteChanged && !localChanged) {
      return { action: "keep-remote", reason: "remote-only-change", mutation: false };
    }

    if (localUpdated > remoteUpdated) {
      return { action: "keep-local", reason: "local-newer", mutation: false };
    }

    if (remoteUpdated > localUpdated) {
      return { action: "keep-remote", reason: "remote-newer", mutation: false };
    }

    return { action: "manual-review", reason: "same-timestamp", mutation: false };
  }

  function run() {
    const result = diagnostics();
    try { localStorage.setItem("gotavita_production_guard_last", JSON.stringify({ at: new Date().toISOString(), ok: result.ok, checks: result.checks })); } catch (_) {}
    return result;
  }

  function installEmptyResourceReconciliation() {
    if (window.__GV_EMPTY_RESOURCE_RECONCILIATION_READY || !window.GVData || typeof window.GVData.sync !== "function") return;

    const originalSync = window.GVData.sync.bind(window.GVData);
    const stateNames = Object.freeze({
      clients: "clients", products: "products", services: "services", employees: "employees",
      orders: "orders", payments: "payments", expenses: "expenses", payroll_records: "payrollRecords",
      order_groups: "orderGroups", delivery_routes: "deliveryRoutes", order_group_items: "orderGroupItems",
      delivery_route_items: "deliveryRouteItems", daily_reports: "dailyReports", deleted_orders: "deletedOrders",
      audit_logs: "auditLog"
    });
    const baselineKey = "gotavita_sync_baseline_v1";

    function readBaseline() {
      try {
        const parsed = JSON.parse(window.localStorage?.getItem(baselineKey) || "null");
        return parsed?.state && typeof parsed.state === "object" ? parsed.state : null;
      } catch (_) { return null; }
    }

    function queuedResources() {
      try {
        const queue = typeof window.getSyncQueue === "function" ? window.getSyncQueue() : [];
        return new Set(Array.isArray(queue) ? queue.filter(Boolean) : []);
      } catch (_) { return new Set(); }
    }

    async function reconcile(result) {
      if (!result?.ok || !window.GVData?.supportedResources || typeof window.GVData.selectResource !== "function") return result;
      if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return result;

      const baseline = readBaseline();
      if (!baseline) return result;

      const queued = queuedResources();
      const state = window.getStateSnapshot();
      const supported = window.GVData.supportedResources();
      const cleared = [];

      for (const resource of supported) {
        const stateName = stateNames[resource];
        if (!stateName || queued.has(resource) || !Object.prototype.hasOwnProperty.call(baseline, stateName)) continue;

        const localRows = Array.isArray(state[stateName]) ? state[stateName] : [];
        if (!localRows.length) continue;

        try {
          const remoteRows = await window.GVData.selectResource(resource);
          if (Array.isArray(remoteRows) && remoteRows.length === 0) {
            state[stateName] = [];
            cleared.push(resource);
          }
        } catch (_) {}
      }

      if (!cleared.length) return result;

      const now = Date.now();
      state._meta = Object.assign({}, state._meta, {
        lastUpdated: now,
        lastSynchronizedAt: now,
        lastRemoteChangedResources: [...new Set([...(result.remoteChangedResources || []), ...cleared])]
      });

      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(state);

      return Object.assign({}, result, {
        remoteChanged: true,
        stateChanged: true,
        renderRequired: true,
        remoteChangedResources: [...new Set([...(result.remoteChangedResources || []), ...cleared])],
        emptyRemoteResourcesCleared: cleared
      });
    }

    window.GVData = Object.freeze(Object.assign({}, window.GVData, {
      sync: async function (...args) {
        const result = await originalSync(...args);
        return reconcile(result);
      }
    }));

    window.__GV_EMPTY_RESOURCE_RECONCILIATION_READY = true;
  }

  window.GVConflictDetector = Object.freeze({
    detect,
    resolveConflictPolicy,
    rowKey,
    rowUpdatedAt,
    rowDeletedAt,
    isDeleted,
    parseTime
  });

  window.GVProductionGuard = Object.freeze({ diagnostics, run, isLocal, cloudConfigured });
  window.addEventListener("load", () => { try { run(); } catch (_) {} }, { once: true });

  window.addEventListener("DOMContentLoaded", () => {
    try {
      if (!document.querySelector('script[data-gv-conflict-integration="true"]')) {
        const script = document.createElement("script");
        script.src = "/js/core/conflict-resolution-integration.js";
        script.defer = true;
        script.dataset.gvConflictIntegration = "true";
        document.head.appendChild(script);
      }
      installEmptyResourceReconciliation();
    } catch (_) {}
  }, { once: true });

  // The gateway may be installed before DOMContentLoaded; retry once after all deferred scripts are ready.
  try { installEmptyResourceReconciliation(); } catch (_) {}
})();
