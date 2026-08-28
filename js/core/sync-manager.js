/* GotaVita Manager — Canonical synchronization coordinator v2.
 *
 * Runtime invariants:
 *   1. GVData owns transport and schema mapping only.
 *   2. GVSync owns all remote-to-state synchronization.
 *   3. A durable local mutation outbox records create/update/delete intent.
 *   4. Every successful write phase is followed by a fresh remote read-back.
 *   5. One canonical baseline is maintained.
 *   6. Realtime is an invalidation signal; it never mutates application state.
 *   7. Legacy sync entry points in script.js are compatibility aliases only.
 *   8. Audit logs are not hydrated into the business-state cache.
 */
(function () {
  "use strict";

  const BASELINE_KEY = "gotavita_sync_baseline_v2";
  const OUTBOX_KEY = "gotavita_sync_outbox_v2";
  const LOCAL_SNAPSHOT_KEY = "gotavita_sync_local_snapshot_v2";
  const META_KEY = "gotavita_sync_meta_v2";
  const LEGACY_QUEUE_KEY = "gotavita_sync_queue";
  const POLL_MS = 5000;
  const REALTIME_DEBOUNCE_MS = 100;
  const REALTIME_RETRY_MS = 2000;
  const RENDER_DELAY_MS = 120;

  const RESOURCE_MAP = Object.freeze({
    clients: "clients",
    products: "products",
    services: "services",
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
    deleted_orders: "deletedOrders"
  });

  const REALTIME_TABLES = Object.freeze([
    "clients",
    "products",
    "employees",
    "expenses",
    "order_groups",
    "delivery_routes",
    "orders",
    "deleted_orders"
  ]);

  const HARD_DELETE_RESOURCES = new Set([
    "clients", "products", "employees", "orders", "payments", "expenses",
    "payroll_records", "order_groups", "delivery_routes", "daily_reports", "deleted_orders"
  ]);

  let pollTimer = null;
  let realtimeRetryTimer = null;
  let realtimeDebounceTimer = null;
  let realtimeChannel = null;
  let realtimeStarting = false;
  let inFlight = null;
  let renderTimer = null;
  let initialized = false;
  let committing = false;
  let deferredSync = false;

  function clone(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage?.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch (_) { return fallback; }
  }

  function writeJson(key, value) {
    try { window.localStorage?.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }

  function stableJson(value) {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function stateName(resource) { return RESOURCE_MAP[resource] || resource; }

  function stableKey(resource, row, index = 0) {
    if (resource === "order_group_items") {
      const group = row?.groupLegacyId ?? row?.group_legacy_id ?? row?.groupId;
      const order = row?.orderLegacyId ?? row?.order_legacy_id ?? row?.orderId;
      if (group != null && order != null) return `group:${String(group)}::${String(order)}`;
    }
    if (resource === "delivery_route_items") {
      const route = row?.routeLegacyId ?? row?.route_legacy_id ?? row?.routeId;
      const order = row?.orderLegacyId ?? row?.order_legacy_id ?? row?.orderId;
      if (route != null && order != null) return `route:${String(route)}::${String(order)}`;
    }
    const legacy = row?.legacy_id ?? row?.legacyId;
    if (legacy != null && String(legacy).trim()) return `legacy:${String(legacy).trim()}`;
    if (row?.id != null && String(row.id).trim()) return `id:${String(row.id).trim()}`;
    return `index:${index}`;
  }

  function identity(row) { return String(row?.legacy_id ?? row?.legacyId ?? row?.id ?? "").trim(); }

  function rowTime(row) {
    const raw = row?.updatedAt ?? row?.updated_at ?? row?.deletedAt ?? row?.deleted_at ?? row?.archivedAt ?? row?.archived_at ?? row?.createdAt ?? row?.created_at ?? row?.date ?? row?.order_date;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
    const parsed = Date.parse(String(raw || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function comparableRow(resource, row) {
    if (!row || typeof row !== "object") return row;
    const copy = clone(row);
    for (const key of ["createdAt", "created_at", "updatedAt", "updated_at"]) delete copy[key];
    if (resource === "order_groups" || resource === "delivery_routes") delete copy.orderIds;
    return copy;
  }

  function rowsEqual(resource, left, right) {
    return stableJson(comparableRow(resource, left)) === stableJson(comparableRow(resource, right));
  }

  function sortedRows(resource, rows) {
    return (Array.isArray(rows) ? rows : []).map(clone).sort((a, b) => stableKey(resource, a).localeCompare(stableKey(resource, b)));
  }

  function rowMap(resource, rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => map.set(stableKey(resource, row, index), row));
    return map;
  }

  function stateSnapshot() { return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null; }

  function replaceState(next) {
    if (typeof window.replaceState !== "function") throw new Error("Application state replacement boundary is unavailable.");
    window.replaceState(next);
  }

  function readBaseline() { return readJson(BASELINE_KEY, { version: 2, companyId: null, savedAt: 0, state: {} }); }

  function saveBaseline(state, companyId) {
    const baselineState = {};
    for (const [resource, stateKey] of Object.entries(RESOURCE_MAP)) baselineState[stateKey] = sortedRows(resource, state?.[stateKey]);
    return writeJson(BASELINE_KEY, { version: 2, companyId: companyId || null, savedAt: Date.now(), state: baselineState });
  }

  function readOutbox() {
    const rows = readJson(OUTBOX_KEY, []);
    return Array.isArray(rows) ? rows.filter((entry) => entry && entry.resource && entry.key && ["upsert", "delete"].includes(entry.operation)) : [];
  }

  function writeOutbox(rows) { return writeJson(OUTBOX_KEY, Array.isArray(rows) ? rows : []); }

  function coalesceOutbox(rows) {
    const latest = new Map();
    for (const entry of rows) latest.set(`${entry.resource}::${entry.key}`, entry);
    return [...latest.values()].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  function localSnapshot() { return readJson(LOCAL_SNAPSHOT_KEY, null); }
  function saveLocalSnapshot(state) { return writeJson(LOCAL_SNAPSHOT_KEY, clone(state)); }

  function captureLocalMutations(previous, current) {
    const changes = [];
    const capturedAt = new Date().toISOString();

    for (const [resource, stateKey] of Object.entries(RESOURCE_MAP)) {
      const before = rowMap(resource, previous?.[stateKey] || []);
      const after = rowMap(resource, current?.[stateKey] || []);

      for (const [key, row] of after) {
        const old = before.get(key);
        if (!old || !rowsEqual(resource, old, row)) {
          changes.push({
            version: 2,
            id: `${resource}:${key}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            resource,
            key,
            operation: "upsert",
            row: clone(row),
            createdAt: capturedAt
          });
        }
      }

      for (const [key, old] of before) {
        if (!after.has(key)) {
          changes.push({
            version: 2,
            id: `${resource}:${key}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            resource,
            key,
            operation: "delete",
            row: clone(old),
            createdAt: capturedAt
          });
        }
      }
    }

    return changes;
  }

  function capturePendingLocalMutations(current) {
    const previous = localSnapshot();
    if (!previous) {
      saveLocalSnapshot(current);
      return [];
    }
    const changes = captureLocalMutations(previous, current);
    if (changes.length) writeOutbox(coalesceOutbox([...readOutbox(), ...changes]));
    saveLocalSnapshot(current);
    return changes;
  }

  function clearLegacyQueue() {
    try { window.localStorage?.removeItem(LEGACY_QUEUE_KEY); } catch (_) {}
    try { if (typeof window.setSyncQueue === "function") window.setSyncQueue([]); } catch (_) {}
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      try {
        if (typeof window.GVUI?.renderAll === "function") window.GVUI.renderAll();
        else if (typeof window.renderAll === "function") window.renderAll();
      } catch (error) { console.warn("GotaVita canonical sync render:", error?.message || error); }
    }, RENDER_DELAY_MS);
  }

  function interactionActive() {
    try { return Boolean(document.activeElement?.closest?.("input:not([type='checkbox']), select, textarea, button")); }
    catch (_) { return false; }
  }

  async function requireManager() {
    if (!window.GVData?.requireAuthenticatedManager) throw new Error("GotaVita data gateway is unavailable.");
    return window.GVData.requireAuthenticatedManager();
  }

  function supportedResources() {
    const source = window.GVData?.supportedResources?.();
    const list = Array.isArray(source) ? source : Object.keys(RESOURCE_MAP);
    return list.filter((resource) => resource !== "audit_logs" && Object.prototype.hasOwnProperty.call(RESOURCE_MAP, resource));
  }

  async function fetchRemoteSet(resources) {
    const results = {};
    const failures = [];
    await Promise.all(resources.map(async (resource) => {
      try {
        const rows = await window.GVData.selectResource(resource);
        results[resource] = Array.isArray(rows) ? rows : [];
      } catch (error) {
        failures.push({ resource, error: String(error?.message || error) });
      }
    }));
    return { results, failures };
  }

  function baselineRow(resource, baseline, key) { return rowMap(resource, baseline?.state?.[stateName(resource)] || []).get(key); }

  function remoteChangedSinceBaseline(resource, remoteRow, previousRow) {
    if (!remoteRow && !previousRow) return false;
    if (!remoteRow && previousRow) return true;
    if (remoteRow && !previousRow) return true;
    return !rowsEqual(resource, remoteRow, previousRow);
  }

  function mutationTime(entry) {
    const parsed = Date.parse(String(entry?.createdAt || ""));
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function localMutationWins(entry, remoteRow) {
    const remoteMs = rowTime(remoteRow);
    return !remoteMs || mutationTime(entry) >= remoteMs;
  }

  function orderTombstone(row, timestamp) {
    const id = identity(row);
    if (!id) return null;
    return {
      id,
      legacy_id: id,
      deleted: true,
      deletedAt: timestamp,
      archivedAt: timestamp,
      updatedAt: timestamp,
      createdAt: row?.createdAt ?? row?.created_at ?? timestamp,
      legacy_payload: clone(row)
    };
  }

  async function applyRemoteDelete(resource, row) {
    if (!row) return;
    if (resource === "order_group_items" && typeof window.GVData.deleteOrderGroupItem === "function") {
      await window.GVData.deleteOrderGroupItem(row.groupLegacyId ?? row.group_legacy_id, row.orderLegacyId ?? row.order_legacy_id);
      return;
    }
    if (resource === "delivery_route_items" && typeof window.GVData.deleteDeliveryRouteItem === "function") {
      await window.GVData.deleteDeliveryRouteItem(row.routeLegacyId ?? row.route_legacy_id, row.orderLegacyId ?? row.order_legacy_id);
      return;
    }
    if (HARD_DELETE_RESOURCES.has(resource) && typeof window.GVData.deleteResourceByLegacyId === "function") {
      const id = row.legacy_id ?? row.legacyId ?? row.id;
      if (id != null) await window.GVData.deleteResourceByLegacyId(resource, id);
      return;
    }
    throw new Error(`No deletion adapter for ${resource}.`);
  }

  async function executeMutation(entry, remoteRows, baseline) {
    const remoteRow = rowMap(entry.resource, remoteRows).get(entry.key);
    const previous = baselineRow(entry.resource, baseline, entry.key);
    const remoteChanged = remoteChangedSinceBaseline(entry.resource, remoteRow, previous);

    if (remoteChanged && !localMutationWins(entry, remoteRow)) return { remoteWon: true, applied: false };

    if (entry.operation === "upsert") {
      await window.GVData.upsertResource(entry.resource, [clone(entry.row)]);
      return { remoteWon: false, applied: true };
    }

    if (entry.resource === "orders") {
      const tombstone = orderTombstone(entry.row, entry.createdAt || new Date().toISOString());
      if (tombstone) await window.GVData.upsertResource("deleted_orders", [tombstone]);
    }

    await applyRemoteDelete(entry.resource, entry.row);
    return { remoteWon: false, applied: true };
  }

  function applyCanonicalSnapshot(nextState, canonical) {
    let changed = false;
    for (const resource of supportedResources()) {
      const stateKey = stateName(resource);
      const nextRows = sortedRows(resource, canonical?.[resource] || []);
      const previousRows = sortedRows(resource, nextState?.[stateKey] || []);
      if (stableJson(nextRows) !== stableJson(previousRows)) changed = true;
      nextState[stateKey] = nextRows;
    }

    const tombstones = sortedRows("deleted_orders", canonical?.deleted_orders || []);
    if (tombstones.length) {
      nextState.deletedOrders = tombstones;
      const deletedIds = new Map(tombstones.map((row) => [identity(row), rowTime(row)]).filter(([id]) => id));
      const priorOrders = Array.isArray(nextState.orders) ? nextState.orders : [];
      const filtered = priorOrders.filter((order) => {
        const deletionTime = deletedIds.get(identity(order));
        return !deletionTime || rowTime(order) > deletionTime;
      });
      if (filtered.length !== priorOrders.length) changed = true;
      nextState.orders = filtered;
    } else if (!Array.isArray(nextState.deletedOrders)) nextState.deletedOrders = [];

    return changed;
  }

  function rebuildDerivedMembership(state) {
    const groups = Array.isArray(state.orderGroups) ? state.orderGroups : [];
    const routes = Array.isArray(state.deliveryRoutes) ? state.deliveryRoutes : [];
    const groupMap = new Map(groups.map((group) => [String(group.id), group]));
    const routeMap = new Map(routes.map((route) => [String(route.id), route]));
    for (const group of groups) group.orderIds = [];
    for (const route of routes) route.orderIds = [];

    for (const item of Array.isArray(state.orderGroupItems) ? state.orderGroupItems : []) {
      const group = groupMap.get(String(item?.groupLegacyId ?? item?.group_legacy_id ?? item?.groupId ?? ""));
      const orderId = item?.orderLegacyId ?? item?.order_legacy_id ?? item?.orderId;
      if (group && orderId != null && !group.orderIds.some((id) => String(id) === String(orderId))) group.orderIds.push(orderId);
    }
    for (const item of Array.isArray(state.deliveryRouteItems) ? state.deliveryRouteItems : []) {
      const route = routeMap.get(String(item?.routeLegacyId ?? item?.route_legacy_id ?? item?.routeId ?? ""));
      const orderId = item?.orderLegacyId ?? item?.order_legacy_id ?? item?.orderId;
      if (route && orderId != null && !route.orderIds.some((id) => String(id) === String(orderId))) route.orderIds.push(orderId);
    }
  }

  async function bootstrap(auth, current) {
    const resources = supportedResources();
    const remoteFirst = await fetchRemoteSet(resources);
    if (remoteFirst.failures.length) throw new Error(`Initial cloud snapshot incomplete: ${remoteFirst.failures.map((item) => item.resource).join(", ")}`);

    for (const resource of resources) {
      const stateKey = stateName(resource);
      const localRows = Array.isArray(current[stateKey]) ? current[stateKey] : [];
      const remoteRows = remoteFirst.results[resource] || [];
      const remoteKeys = rowMap(resource, remoteRows);
      const localOnly = [];
      for (const [key, row] of rowMap(resource, localRows)) if (!remoteKeys.has(key)) localOnly.push(row);
      if (localOnly.length) await window.GVData.upsertResource(resource, localOnly);
    }

    const canonicalResult = await fetchRemoteSet(resources);
    if (canonicalResult.failures.length) throw new Error(`Initial canonical read-back incomplete: ${canonicalResult.failures.map((item) => item.resource).join(", ")}`);

    const nextState = clone(current);
    applyCanonicalSnapshot(nextState, canonicalResult.results);
    rebuildDerivedMembership(nextState);

    committing = true;
    try {
      replaceState(nextState);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);
      saveLocalSnapshot(nextState);
      saveBaseline(nextState, auth?.profile?.company_id);
      clearLegacyQueue();
    } finally { committing = false; }

    scheduleRender();
    setMeta({ status: "synced", reason: "bootstrap", companyId: auth?.profile?.company_id || null, lastSyncAt: new Date().toISOString() });
    return { ok: true, status: "initialized", stateChanged: true };
  }

  async function flush(reason = "poll") {
    if (inFlight) return inFlight;
    if (committing) return { ok: false, status: "commit-in-progress" };
    if (!navigator.onLine) return { ok: false, status: "offline" };
    if (!window.GVAuth?.isAuthorized?.()) return { ok: false, status: "unauthorized" };
    if (interactionActive() && reason === "poll") { deferredSync = true; return { ok: false, status: "deferred-for-interaction" }; }

    inFlight = (async () => {
      const auth = await requireManager();
      const current = stateSnapshot();
      if (!current) throw new Error("Application state snapshot is unavailable.");
      const baseline = readBaseline();

      if (!baseline?.savedAt || baseline.version !== 2 || baseline.companyId !== auth?.profile?.company_id) return bootstrap(auth, current);

      capturePendingLocalMutations(current);
      const outbox = coalesceOutbox(readOutbox());
      const resources = supportedResources();
      const firstRead = await fetchRemoteSet([...resources, "deleted_orders"]);
      if (firstRead.failures.length) {
        setMeta({ status: "partial", reason, failures: firstRead.failures, lastSyncAt: new Date().toISOString() });
        return { ok: false, status: "partial", failures: firstRead.failures };
      }

      const remaining = [];
      const applied = [];
      const remoteWon = [];

      for (const entry of outbox) {
        try {
          const result = await executeMutation(entry, firstRead.results[entry.resource] || [], baseline);
          if (result.remoteWon) remoteWon.push(entry);
          else if (result.applied) applied.push(entry);
          else remaining.push(entry);
        } catch (error) {
          remaining.push(entry);
          console.warn(`GotaVita canonical mutation failed [${entry.resource}:${entry.key}]:`, error?.message || error);
        }
      }

      writeOutbox(remaining);

      const finalRead = await fetchRemoteSet([...resources, "deleted_orders"]);
      if (finalRead.failures.length) {
        setMeta({ status: "partial", reason, failures: finalRead.failures, lastSyncAt: new Date().toISOString() });
        return { ok: false, status: "partial", failures: finalRead.failures };
      }

      const nextState = clone(current);
      const stateChanged = applyCanonicalSnapshot(nextState, finalRead.results);
      rebuildDerivedMembership(nextState);

      committing = true;
      try {
        replaceState(nextState);
        if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);
        saveLocalSnapshot(nextState);
        if (!remaining.length) {
          saveBaseline(nextState, auth?.profile?.company_id);
          clearLegacyQueue();
        }
      } finally { committing = false; }

      setMeta({
        status: remaining.length ? "partial" : "synced",
        reason,
        companyId: auth?.profile?.company_id || null,
        appliedMutations: applied.length,
        remoteWonMutations: remoteWon.length,
        queuedMutations: remaining.length,
        stateChanged,
        lastSyncAt: new Date().toISOString()
      });

      if (stateChanged) scheduleRender();
      return {
        ok: remaining.length === 0,
        status: remaining.length ? "partial" : "synced",
        stateChanged,
        appliedMutations: applied.length,
        remoteWonMutations: remoteWon.length,
        queuedMutations: remaining.length
      };
    })().catch((error) => {
      setMeta({ status: "error", reason, error: String(error?.message || error), lastSyncAt: new Date().toISOString() });
      return { ok: false, status: "error", error: String(error?.message || error) };
    }).finally(() => {
      inFlight = null;
      if (deferredSync && !interactionActive()) {
        deferredSync = false;
        setTimeout(() => flush("deferred").catch(() => {}), 0);
      }
    });

    return inFlight;
  }

  function schedulePolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => flush("poll").catch(() => {}), POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function requestRealtimeSync() {
    if (realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer);
    realtimeDebounceTimer = setTimeout(() => {
      realtimeDebounceTimer = null;
      flush("realtime").catch(() => {});
    }, REALTIME_DEBOUNCE_MS);
  }

  async function stopRealtime() {
    if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
    realtimeRetryTimer = null;
    const client = window.GVAuth?.getClient?.();
    if (client && realtimeChannel) {
      try { await client.removeChannel(realtimeChannel); } catch (_) {}
    }
    realtimeChannel = null;
    realtimeStarting = false;
  }

  async function startRealtime() {
    const client = window.GVAuth?.getClient?.();
    if (!client || window.GVAuth?.isAuthorized?.() !== true || realtimeChannel || realtimeStarting) return;

    realtimeStarting = true;
    try {
      const channel = client.channel("gotavita-sync-v2");
      for (const table of REALTIME_TABLES) channel.on("postgres_changes", { event: "*", schema: "public", table }, () => requestRealtimeSync());
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeChannel = channel;
          realtimeStarting = false;
          if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
          realtimeRetryTimer = null;
          return;
        }
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          if (realtimeChannel === channel) realtimeChannel = null;
          realtimeStarting = false;
          if (!realtimeRetryTimer) realtimeRetryTimer = setTimeout(() => { realtimeRetryTimer = null; startRealtime().catch(() => {}); }, REALTIME_RETRY_MS);
        }
      });
    } catch (error) {
      realtimeStarting = false;
      console.warn("GotaVita canonical Realtime startup:", error?.message || error);
      if (!realtimeRetryTimer) realtimeRetryTimer = setTimeout(() => { realtimeRetryTimer = null; startRealtime().catch(() => {}); }, REALTIME_RETRY_MS);
    }
  }

  function reclaimLegacyRuntimeBoundaries() {
    /* script.js still contains historical implementations for these global
       names. At DOM-ready the whole deferred script graph has executed, so
       this final boundary safely makes those names compatibility aliases to
       GVSync without changing business-module code. */
    window.syncChangedResources = (reason) => window.GVSync.flush(reason || "legacy-entry");
    window.syncNow = () => window.GVSync.flush("manual");
    window.startSyncReliability = () => {};
    window.initSyncReliability = () => {};
    try { if (typeof window.stopSyncReliability === "function") window.stopSyncReliability(); } catch (_) {}
    window.__GV_CANONICAL_SYNC_V2__ = true;
    clearLegacyQueue();
  }

  function bindLifecycle() {
    if (initialized) return;
    initialized = true;

    /* This listener is registered by sync-manager before script.js registers
       its DOMContentLoaded handler. It therefore reclaims the legacy global
       functions before script.js can start the old scheduler. */
    reclaimLegacyRuntimeBoundaries();

    window.addEventListener("gv-auth-state-changed", (event) => {
      if (event?.detail?.authenticated === true) {
        schedulePolling();
        startRealtime().catch(() => {});
        flush("auth").catch(() => {});
      } else {
        stopPolling();
        stopRealtime().catch(() => {});
      }
    });

    window.addEventListener("online", () => {
      startRealtime().catch(() => {});
      flush("online").catch(() => {});
    });
    window.addEventListener("focus", () => flush("focus").catch(() => {}));
    window.addEventListener("pageshow", () => flush("pageshow").catch(() => {}));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flush("visible").catch(() => {}); });
    document.addEventListener("focusout", () => {
      if (deferredSync && !interactionActive()) {
        deferredSync = false;
        flush("interaction-release").catch(() => {});
      }
    }, true);

    if (window.GVAuth?.isAuthorized?.()) {
      schedulePolling();
      startRealtime().catch(() => {});
      flush("startup").catch(() => {});
    }
  }

  window.GVSync = Object.freeze({
    flush,
    poll: () => flush("poll"),
    request: (reason = "request") => flush(reason),
    startPolling: schedulePolling,
    stopPolling,
    startRealtime,
    stopRealtime,
    getBaseline: readBaseline,
    getOutbox: () => coalesceOutbox(readOutbox()),
    meta: () => readJson(META_KEY, {}),
    resetBaseline: () => writeJson(BASELINE_KEY, { version: 2, companyId: null, savedAt: 0, state: {} }),
    clearOutbox: () => writeOutbox([])
  });

  /* The aliases are installed immediately for modules that execute after this
     file; they are reclaimed again at DOM-ready after script.js is evaluated. */
  window.syncChangedResources = (reason) => window.GVSync.flush(reason || "legacy-entry");
  window.syncNow = () => window.GVSync.flush("manual");

  window.addEventListener("DOMContentLoaded", bindLifecycle, { once: true });
})();