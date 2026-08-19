/* GotaVita Manager — Sprint 12 Controlled Conflict Resolution Integration
 *
 * Anti Big Bang 2.0 gate:
 * detector -> pure policy -> safe integration -> unambiguous apply -> reconcile.
 *
 * Safety contract:
 * - manual-review never mutates local state or Supabase.
 * - no queue clearing occurs until every record in a resource is resolved.
 * - Supabase writes occur only for keep-local decisions.
 * - keep-remote decisions update local state only.
 * - every resource gets a fresh remote baseline after successful reconciliation.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "gotavita_conflict_baseline_v1";
  const CONFLICT_KEY = "gotavita_sync_conflicts";
  const RUN_LOCK_KEY = "gotavita_conflict_integration_lock";

  const RESOURCE_MAP = Object.freeze({
    products: "products",
    clients: "clients",
    employees: "employees",
    orders: "orders",
    payments: "payments",
    expenses: "expenses",
    payrollRecords: "payroll_records",
    orderGroups: "order_groups",
    deliveryRoutes: "delivery_routes",
    orderGroupItems: "order_group_items",
    deliveryRouteItems: "delivery_route_items",
    dailyReports: "daily_reports",
    deletedOrders: "deleted_orders",
    auditLog: "audit_logs"
  });

  const STATE_MAP = Object.freeze({
    products: "products",
    clients: "clients",
    employees: "employees",
    orders: "orders",
    payments: "payments",
    expenses: "expenses",
    payroll_records: "payrollRecords",
    order_groups: "orderGroups",
    delivery_routes: "deliveryRoutes",
    order_group_items: "orderGroupItems",
    delivery_route_items: "deliveryRouteItems",
    daily_reports: "dailyReports",
    deleted_orders: "deletedOrders",
    audit_logs: "auditLog"
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function rowKey(row, index) {
    if (window.GVConflictDetector?.rowKey) {
      const key = window.GVConflictDetector.rowKey(row);
      if (key != null) return String(key);
    }
    if (row?.id != null) return String(row.id);
    if (row?.legacy_id != null) return String(row.legacy_id);
    return `index:${index}`;
  }

  function indexRows(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      map.set(rowKey(row, index), row);
    });
    return map;
  }

  function policy(localRow, remoteRow, baselineAt) {
    if (!window.GVConflictDetector?.resolveConflictPolicy) {
      return { action: "manual-review", reason: "policy-unavailable", mutation: false };
    }
    return window.GVConflictDetector.resolveConflictPolicy(localRow, remoteRow, baselineAt);
  }

  function deletionEvidence(rows, key) {
    return (Array.isArray(rows) ? rows : []).find((row) => rowKey(row) === key) || null;
  }

  function tombstone(row, deletedAt) {
    if (!deletedAt) return null;
    return {
      id: row?.id,
      legacy_id: row?.legacy_id,
      deleted: true,
      deletedAt,
      updatedAt: deletedAt
    };
  }

  function baselinePlaceholder(id, baselineAt) {
    if (!baselineAt) return null;
    return {
      id,
      updatedAt: baselineAt,
      createdAt: baselineAt
    };
  }

  function buildResolutionPlan(localRows, remoteRows, baselineAt, localDeletedRows = [], remoteDeletedRows = [], baselineRows = []) {
    const localMap = indexRows(localRows);
    const remoteMap = indexRows(remoteRows);
    const baselineMap = indexRows(baselineRows);
    const ids = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const decisions = [];

    for (const id of ids) {
      let localRow = localMap.get(id) || null;
      let remoteRow = remoteMap.get(id) || null;
      const existedAtBaseline = baselineMap.has(id);

      if (!localRow) {
        const evidence = deletionEvidence(localDeletedRows, id);
        localRow = evidence ? tombstone(evidence, evidence.archivedAt || evidence.deletedAt) : (existedAtBaseline ? null : baselinePlaceholder(id, baselineAt));
      }

      if (!remoteRow) {
        const evidence = deletionEvidence(remoteDeletedRows, id);
        remoteRow = evidence ? tombstone(evidence, evidence.archivedAt || evidence.deletedAt) : (existedAtBaseline ? null : baselinePlaceholder(id, baselineAt));
      }

      const result = policy(localRow, remoteRow, baselineAt);
      decisions.push({ id, action: result.action, reason: result.reason, mutation: result.mutation, local: localMap.get(id) || null, remote: remoteMap.get(id) || null });
    }

    return decisions;
  }

  function summarize(decisions) {
    const summary = { total: decisions.length, keepLocal: 0, keepRemote: 0, noConflict: 0, manualReview: 0 };
    decisions.forEach((decision) => {
      if (decision.action === "keep-local") summary.keepLocal++;
      else if (decision.action === "keep-remote") summary.keepRemote++;
      else if (decision.action === "no-conflict") summary.noConflict++;
      else summary.manualReview++;
    });
    return summary;
  }

  function getBaseline() { return readJson(STORAGE_KEY, {}); }
  function setBaseline(next) { return writeJson(STORAGE_KEY, next); }

  function recordConflicts(entries) {
    if (!entries.length) return;
    const current = readJson(CONFLICT_KEY, []);
    writeJson(CONFLICT_KEY, [...current, ...entries].slice(-200));
  }

  function removeResourceFromQueue(resource) {
    if (typeof window.getSyncQueue !== "function" || typeof window.setSyncQueue !== "function") return;
    const queue = window.getSyncQueue();
    window.setSyncQueue(queue.filter((item) => item !== resource && resourceCloudName(item) !== resource));
  }

  function resourceCloudName(resource) { return RESOURCE_MAP[resource] || resource; }
  function resourceStateName(resource) { return STATE_MAP[resource] || resource; }

  function stateSnapshot() {
    const snapshotReader = window["getStateSnapshot"];
    return typeof snapshotReader === "function" ? snapshotReader() : null;
  }

  function supportedResources() {
    return Object.keys(RESOURCE_MAP).filter((resource) => {
      const cloudName = resourceCloudName(resource);
      return window.GVData && typeof window.GVData.selectResource === "function" && typeof window.GVData.upsertResource === "function" &&
        (!window.GVData.supportedResources || window.GVData.supportedResources().includes(cloudName));
    });
  }

  async function applyDecision(resource, decision, nextState) {
    const cloudName = resourceCloudName(resource);
    const stateName = resourceStateName(cloudName);

    if (decision.action === "keep-local") {
      if (decision.local) await window.GVData.upsertResource(cloudName, [decision.local]);
      else if (typeof window.GVData.deleteResourceByLegacyId === "function") {
        const id = decision.remote?.id ?? decision.remote?.legacy_id ?? decision.id;
        if (id != null) await window.GVData.deleteResourceByLegacyId(cloudName, id);
      }
      return;
    }

    if (decision.action === "keep-remote") {
      const rows = Array.isArray(nextState[stateName]) ? nextState[stateName].slice() : [];
      const index = rows.findIndex((row, index) => rowKey(row, index) === decision.id);
      if (decision.remote) {
        if (index >= 0) rows[index] = clone(decision.remote);
        else rows.push(clone(decision.remote));
      } else if (index >= 0) rows.splice(index, 1);
      nextState[stateName] = rows;
    }
  }

  async function reconcileResource(resource, localRows, remoteRows, baselineAt, localDeletedRows, remoteDeletedRows, baselineRows, nextState) {
    const decisions = buildResolutionPlan(localRows, remoteRows, baselineAt, localDeletedRows, remoteDeletedRows, baselineRows);
    const summary = summarize(decisions);
    const manual = decisions.filter((decision) => decision.action === "manual-review");

    if (manual.length) {
      recordConflicts(manual.map((decision) => ({ resource, id: decision.id, reason: decision.reason, detectedAt: new Date().toISOString() })));
      return { resource, decisions, summary, reconciled: false };
    }

    for (const decision of decisions) {
      if (decision.action === "keep-local" || decision.action === "keep-remote") await applyDecision(resource, decision, nextState);
    }

    return { resource, decisions, summary, reconciled: true };
  }

  async function run(force = false) {
    if (!navigator.onLine || window.location.protocol === "file:") return { ok: false, status: "offline-or-local" };
    if (window.GVData?.isConfigured?.() !== true) return { ok: false, status: "not-configured" };
    if (!window.GVConflictDetector?.resolveConflictPolicy) return { ok: false, status: "policy-unavailable" };
    if (!force && sessionStorage.getItem(RUN_LOCK_KEY) === "1") return { ok: false, status: "locked" };

    sessionStorage.setItem(RUN_LOCK_KEY, "1");
    try {
      await window.GVData.requireAuthenticatedManager();
      const baseline = getBaseline();
      const nextState = stateSnapshot();
      if (!nextState) throw new Error("Application state snapshot unavailable.");
      const results = [];
      const nextBaseline = { ...baseline };

      for (const resource of supportedResources()) {
        const stateName = resourceStateName(resource);
        const localRows = Array.isArray(nextState[stateName]) ? nextState[stateName] : [];
        const remoteRows = await window.GVData.selectResource(resourceCloudName(resource));
        const baselineAt = baseline[resource]?.baselineAt || null;

        if (!baselineAt) {
          nextBaseline[resource] = { baselineAt: new Date().toISOString(), rows: clone(remoteRows) };
          results.push({ resource, status: "baseline-initialized", summary: { total: 0, keepLocal: 0, keepRemote: 0, noConflict: 0, manualReview: 0 } });
          continue;
        }

        const baselineRows = Array.isArray(baseline[resource]?.rows) ? baseline[resource].rows : [];
        const localDeletedRows = resource === "orders" ? (nextState.deletedOrders || []) : [];
        const remoteDeletedRows = resource === "orders" ? await window.GVData.selectResource("deleted_orders") : [];
        const result = await reconcileResource(resource, localRows, remoteRows, baselineAt, localDeletedRows, remoteDeletedRows, baselineRows, nextState);
        results.push(result);

        if (result.reconciled) {
          const refreshed = await window.GVData.selectResource(resourceCloudName(resource));
          nextBaseline[resource] = { baselineAt: new Date().toISOString(), rows: clone(refreshed) };
          removeResourceFromQueue(resourceCloudName(resource));
        }
      }

      if (typeof window.persistState === "function") window.persistState();
      setBaseline(nextBaseline);
      const manualReviewCount = results.reduce((sum, result) => sum + (result.summary?.manualReview || 0), 0);
      const appliedCount = results.reduce((sum, result) => sum + (result.summary?.keepLocal || 0) + (result.summary?.keepRemote || 0), 0);

      if (typeof window.setSyncStatus === "function") window.setSyncStatus(manualReviewCount ? `Conflict review required · ${manualReviewCount}` : `Synced · ${appliedCount} conflict decision(s) applied`, manualReviewCount ? "warning" : "online");
      return { ok: true, status: manualReviewCount ? "manual-review" : "reconciled", results };
    } finally {
      sessionStorage.removeItem(RUN_LOCK_KEY);
    }
  }

  window.GVConflictIntegration = Object.freeze({ run, buildResolutionPlan, summarize, getBaseline, setBaseline, resourceCloudName, resourceStateName });

  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) setTimeout(() => run(false).catch((error) => console.warn("GotaVita conflict integration:", error?.message || error)), 0);
  });
})();
