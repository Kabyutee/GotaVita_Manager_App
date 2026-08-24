/* GotaVita Manager — Universal Canonical Synchronization */
(function () {
  "use strict";

  const STORAGE_KEY = "gotavita_conflict_baseline_v1";
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

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function readJson(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
  function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
  function stableRowId(row) {
    if (row?.legacy_id != null && String(row.legacy_id).trim() !== "") return String(row.legacy_id).trim();
    if (row?.legacyId != null && String(row.legacyId).trim() !== "") return String(row.legacyId).trim();
    if (row?.id != null && String(row.id).trim() !== "") return String(row.id).trim();
    return null;
  }
  function rowKey(row, index) {
    const stable = stableRowId(row);
    if (stable != null) return stable;
    if (window.GVConflictDetector?.rowKey) {
      const key = window.GVConflictDetector.rowKey(row);
      if (key != null) return String(key);
    }
    return `index:${index}`;
  }
  function indexRows(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => map.set(rowKey(row, index), row));
    return map;
  }
  function comparableRow(row) {
    if (!row || typeof row !== "object") return row;
    const output = {};
    for (const [key, value] of Object.entries(row)) {
      if (/^(updatedAt|updated_at|createdAt|created_at)$/.test(key)) continue;
      output[key] = value;
    }
    return output;
  }
  function rowsEquivalent(left, right) {
    try { return JSON.stringify(comparableRow(left)) === JSON.stringify(comparableRow(right)); }
    catch (_) { return false; }
  }
  function resourceCloudName(resource) { return RESOURCE_MAP[resource] || resource; }
  function resourceStateName(resource) { return STATE_MAP[resource] || resource; }
  function stateSnapshot() { return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null; }
  function queueResources() {
    try {
      return typeof window.getSyncQueue === "function" && Array.isArray(window.getSyncQueue())
        ? window.getSyncQueue().map((item) => String(item)).filter(Boolean)
        : [];
    } catch (_) { return []; }
  }
  function resourceHasPendingLocalWrite(resource) {
    const cloudName = resourceCloudName(resource);
    const queue = queueResources();
    return queue.includes(resource) || queue.includes(cloudName);
  }
  function removeResourceFromQueue(resource) {
    if (typeof window.getSyncQueue !== "function" || typeof window.setSyncQueue !== "function") return;
    const cloudName = resourceCloudName(resource);
    const queue = window.getSyncQueue();
    window.setSyncQueue(queue.filter((item) => item !== resource && item !== cloudName));
  }
  function getBaseline() { return readJson(STORAGE_KEY, {}); }
  function setBaseline(next) { return writeJson(STORAGE_KEY, next); }
  function deletionEvidence(rows, key) {
    return (Array.isArray(rows) ? rows : []).find((row, index) => rowKey(row, index) === key) || null;
  }
  function isOrderResource(resource) { return resourceCloudName(resource) === "orders"; }
  function isDeletableByEvidence(resource, row, deletedRows) {
    if (!isOrderResource(resource)) return false;
    const key = stableRowId(row);
    return key != null && Boolean(deletionEvidence(deletedRows, key));
  }
  function supportedResources() {
    if (!window.GVData) return [];
    return Object.keys(RESOURCE_MAP).filter((resource) => {
      // audit_logs is an append-only history stream, not application state.
      // Never hydrate the full cloud audit table into LocalStorage-backed state
      // or include it in the canonical whole-state reconciliation transaction.
      if (resource === "auditLog") return false;

      const cloudName = resourceCloudName(resource);
      return typeof window.GVData.selectResource === "function" &&
        typeof window.GVData.upsertResource === "function" &&
        (!window.GVData.supportedResources || window.GVData.supportedResources().includes(cloudName));
    });
  }

  function buildResolutionPlan(resource, localRows, remoteRows, localDeletedRows = [], remoteDeletedRows = []) {
    const localMap = indexRows(localRows);
    const remoteMap = indexRows(remoteRows);
    const pendingLocalWrite = resourceHasPendingLocalWrite(resource);
    const decisions = [];
    const ids = new Set([...localMap.keys(), ...remoteMap.keys()]);

    for (const id of ids) {
      const localRow = localMap.get(id) || null;
      const remoteRow = remoteMap.get(id) || null;

      if (localRow && remoteRow) {
        if (rowsEquivalent(localRow, remoteRow)) {
          decisions.push({ id, action: "no-conflict", reason: "rows-equivalent", mutation: false, local: localRow, remote: remoteRow });
        } else if (pendingLocalWrite) {
          decisions.push({ id, action: "keep-local", reason: "pending-local-write", mutation: true, local: localRow, remote: remoteRow });
        } else {
          decisions.push({ id, action: "keep-remote", reason: "remote-canonical", mutation: false, local: localRow, remote: remoteRow });
        }
        continue;
      }

      if (remoteRow && !localRow) {
        if (isOrderResource(resource) && deletionEvidence(localDeletedRows, id)) {
          decisions.push({ id, action: "delete-remote", reason: "explicit-local-deletion-evidence", mutation: true, local: null, remote: remoteRow });
        } else {
          decisions.push({ id, action: "keep-remote", reason: "remote-new-record", mutation: false, local: null, remote: remoteRow });
        }
        continue;
      }

      if (localRow && !remoteRow) {
        if (pendingLocalWrite) {
          decisions.push({ id, action: "keep-local", reason: "pending-local-create-or-update", mutation: true, local: localRow, remote: null });
        } else if (isDeletableByEvidence(resource, localRow, remoteDeletedRows)) {
          decisions.push({ id, action: "delete-local", reason: "explicit-remote-deletion-evidence", mutation: false, local: localRow, remote: null });
        } else {
          decisions.push({ id, action: "preserve-local", reason: "remote-row-missing-without-deletion-evidence", mutation: false, local: localRow, remote: null });
        }
      }
    }
    return decisions;
  }

  function summarize(decisions) {
    const summary = { total: decisions.length, keepLocal: 0, keepRemote: 0, preserveLocal: 0, deleteLocal: 0, deleteRemote: 0, noConflict: 0 };
    decisions.forEach((decision) => {
      if (decision.action === "keep-local") summary.keepLocal++;
      else if (decision.action === "keep-remote") summary.keepRemote++;
      else if (decision.action === "preserve-local") summary.preserveLocal++;
      else if (decision.action === "delete-local") summary.deleteLocal++;
      else if (decision.action === "delete-remote") summary.deleteRemote++;
      else if (decision.action === "no-conflict") summary.noConflict++;
    });
    return summary;
  }

  async function applyDecision(resource, decision, nextState) {
    const cloudName = resourceCloudName(resource);
    const stateName = resourceStateName(cloudName);
    const rows = Array.isArray(nextState[stateName]) ? nextState[stateName].slice() : [];
    const index = rows.findIndex((row, rowIndex) => rowKey(row, rowIndex) === decision.id);

    if (decision.action === "keep-local" && decision.local) {
      await window.GVData.upsertResource(cloudName, [decision.local]);
      return;
    }
    if (decision.action === "keep-remote") {
      if (decision.remote) {
        if (index >= 0) rows[index] = clone(decision.remote);
        else rows.push(clone(decision.remote));
      } else if (index >= 0) rows.splice(index, 1);
      nextState[stateName] = rows;
      return;
    }
    if (decision.action === "delete-local") {
      if (index >= 0) rows.splice(index, 1);
      nextState[stateName] = rows;
      return;
    }
    if (decision.action === "delete-remote" && typeof window.GVData.deleteResourceByLegacyId === "function") {
      await window.GVData.deleteResourceByLegacyId(cloudName, decision.id);
    }
  }

  async function reconcileResource(resource, localRows, remoteRows, localDeletedRows, remoteDeletedRows, nextState) {
    const decisions = buildResolutionPlan(resource, localRows, remoteRows, localDeletedRows, remoteDeletedRows);
    const summary = summarize(decisions);
    for (const decision of decisions) await applyDecision(resource, decision, nextState);
    return { resource, decisions, summary, reconciled: true, partial: false, unresolvedCount: 0 };
  }

  async function run(force = false) {
    if (!navigator.onLine || window.location.protocol === "file:") return { ok: false, status: "offline-or-local" };
    if (window.GVData?.isConfigured?.() !== true) return { ok: false, status: "not-configured" };
    if (!force && sessionStorage.getItem(RUN_LOCK_KEY) === "1") return { ok: false, status: "locked" };
    sessionStorage.setItem(RUN_LOCK_KEY, "1");
    try {
      await window.GVData.requireAuthenticatedManager();
      const nextState = stateSnapshot();
      if (!nextState) throw new Error("Application state snapshot unavailable.");
      const baseline = getBaseline();
      const nextBaseline = { ...baseline };
      const results = [];

      for (const resource of supportedResources()) {
        const stateName = resourceStateName(resource);
        const cloudName = resourceCloudName(resource);
        const localRows = Array.isArray(nextState[stateName]) ? nextState[stateName].slice() : [];
        const remoteRows = await window.GVData.selectResource(cloudName);
        const normalizedRemoteRows = Array.isArray(remoteRows) ? remoteRows : [];
        const localDeletedRows = cloudName === "orders" ? (nextState.deletedOrders || []) : [];
        const remoteDeletedRows = cloudName === "orders" ? ((await window.GVData.selectResource("deleted_orders")) || []) : [];
        const result = await reconcileResource(resource, localRows, normalizedRemoteRows, localDeletedRows, remoteDeletedRows, nextState);
        results.push({ ...result, status: "canonicalized" });
        const pending = resourceHasPendingLocalWrite(resource);
        const refreshed = pending ? await window.GVData.selectResource(cloudName) : normalizedRemoteRows;
        nextBaseline[resource] = { baselineAt: new Date().toISOString(), rows: clone(refreshed) };
        if (pending || !result.partial) removeResourceFromQueue(cloudName);
      }

      if (typeof window.GVGroupMembershipBridge?.reconcileRemoteState === "function") window.GVGroupMembershipBridge.reconcileRemoteState(nextState);
      if (typeof window.replaceState === "function") window.replaceState(nextState);
      if (typeof window.persistState === "function") window.persistState();
      setBaseline(nextBaseline);

      const summary = results.reduce((acc, result) => {
        for (const key of Object.keys(acc)) acc[key] += result.summary?.[key] || 0;
        return acc;
      }, { keepLocal: 0, keepRemote: 0, preserveLocal: 0, deleteLocal: 0, deleteRemote: 0, noConflict: 0 });

      if (typeof window.setSyncStatus === "function") {
        window.setSyncStatus(`Synced · ${summary.keepRemote} remote, ${summary.keepLocal} local, ${summary.deleteLocal + summary.deleteRemote} deletions, ${summary.preserveLocal} protected`, "online");
      }
      return { ok: true, status: "reconciled", results, summary };
    } finally {
      sessionStorage.removeItem(RUN_LOCK_KEY);
    }
  }

  window.GVConflictIntegration = Object.freeze({ run, buildResolutionPlan, summarize, getBaseline, setBaseline, resourceCloudName, resourceStateName, supportedResources });
  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) setTimeout(() => run(false).catch((error) => console.warn("GotaVita universal sync:", error?.message || error)), 0);
  });
})();