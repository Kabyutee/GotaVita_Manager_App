/* GotaVita Manager — Canonical synchronization coordinator v2. */
(function () {
  "use strict";

  const BASELINE_KEY = "gotavita_sync_baseline_v2";
  const META_KEY = "gotavita_sync_meta_v2";
  const POLL_MS = 5000;
  const RELEASE_RENDER_MS = 200;

  const RESOURCE_MAP = Object.freeze({
    clients: "clients", products: "products", services: "services", employees: "employees",
    orders: "orders", payments: "payments", expenses: "expenses", payroll_records: "payrollRecords",
    order_groups: "orderGroups", delivery_routes: "deliveryRoutes", order_group_items: "orderGroupItems",
    delivery_route_items: "deliveryRouteItems", daily_reports: "dailyReports", deleted_orders: "deletedOrders"
  });

  const LEGACY_DELETE_RESOURCES = new Set([
    "clients", "products", "employees", "orders", "payments", "expenses", "payroll_records",
    "order_groups", "delivery_routes", "daily_reports", "deleted_orders"
  ]);

  let timer = null;
  let inFlight = null;
  let renderTimer = null;
  let initialized = false;
  let committing = false;
  let localWriteHookInstalled = false;
  let deferredSync = false;

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

  function clone(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function stableJson(value) {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  function readBaseline() {
    return readJson(BASELINE_KEY, { version: 2, companyId: null, savedAt: 0, state: {} });
  }

  function writeBaseline(state, companyId) {
    const resources = {};
    for (const stateName of Object.values(RESOURCE_MAP)) {
      resources[stateName] = Array.isArray(state?.[stateName]) ? clone(state[stateName]) : [];
    }
    return writeJson(BASELINE_KEY, { version: 2, companyId: companyId || null, savedAt: Date.now(), state: resources });
  }

  function setMeta(patch) {
    writeJson(META_KEY, { ...readJson(META_KEY, {}), ...patch, updatedAt: new Date().toISOString() });
  }

  function resourceStateName(resource) { return RESOURCE_MAP[resource] || resource; }

  function stableKey(row, index = 0) {
    const legacy = row?.legacy_id ?? row?.legacyId;
    if (legacy != null && String(legacy).trim()) return `legacy:${String(legacy).trim()}`;
    if (row?.groupLegacyId != null && row?.orderLegacyId != null) return `group:${String(row.groupLegacyId)}::${String(row.orderLegacyId)}`;
    if (row?.routeLegacyId != null && row?.orderLegacyId != null) return `route:${String(row.routeLegacyId)}::${String(row.orderLegacyId)}`;
    if (row?.id != null && String(row.id).trim()) return `id:${String(row.id).trim()}`;
    return `index:${index}`;
  }

  function rawIdentity(row) { return String(row?.legacy_id ?? row?.legacyId ?? row?.id ?? "").trim(); }

  function rowTime(row) {
    const raw = row?.updatedAt ?? row?.updated_at ?? row?.deletedAt ?? row?.archivedAt ?? row?.createdAt ?? row?.created_at ?? row?.date ?? row?.order_date;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
    const parsed = Date.parse(String(raw || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function comparable(row) {
    if (!row || typeof row !== "object") return row;
    const copy = clone(row);
    for (const key of ["createdAt", "created_at", "updatedAt", "updated_at"]) delete copy[key];
    return copy;
  }

  function rowsEqual(a, b) { return stableJson(comparable(a)) === stableJson(comparable(b)); }

  function index(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, i) => map.set(stableKey(row, i), row));
    return map;
  }

  function stateSnapshot() {
    return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
  }

  function replaceState(nextState) {
    if (typeof window.replaceState !== "function") throw new Error("Application state replacement boundary is unavailable.");
    window.replaceState(nextState);
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      try {
        if (typeof window.GVUI?.renderAll === "function") window.GVUI.renderAll();
        else if (typeof window.renderAll === "function") window.renderAll();
      } catch (error) { console.warn("GotaVita canonical sync render:", error?.message || error); }
    }, RELEASE_RENDER_MS);
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
    return list.filter((resource) => resource !== "audit_logs");
  }

  async function fetchRemoteSet(resources) {
    const entries = await Promise.all(resources.map(async (resource) => [resource, await window.GVData.selectResource(resource)]));
    return Object.fromEntries(entries.map(([resource, rows]) => [resource, Array.isArray(rows) ? rows : []]));
  }

  function chooseWinner(localRow, remoteRow) {
    const lt = rowTime(localRow), rt = rowTime(remoteRow);
    if (lt > rt) return "local";
    if (rt > lt) return "remote";
    const left = stableJson(comparable(localRow)), right = stableJson(comparable(remoteRow));
    return left === right ? "same" : (left > right ? "local" : "remote");
  }

  async function deleteRemote(resource, row) {
    if (!row) return false;
    if (LEGACY_DELETE_RESOURCES.has(resource) && typeof window.GVData.deleteResourceByLegacyId === "function") {
      const id = row.legacy_id ?? row.legacyId ?? row.id;
      if (id != null) { await window.GVData.deleteResourceByLegacyId(resource, id); return true; }
    }
    if (resource === "order_group_items" && typeof window.GVData.deleteOrderGroupItem === "function") {
      await window.GVData.deleteOrderGroupItem(row.groupLegacyId ?? row.group_legacy_id, row.orderLegacyId ?? row.order_legacy_id); return true;
    }
    if (resource === "delivery_route_items" && typeof window.GVData.deleteDeliveryRouteItem === "function") {
      await window.GVData.deleteDeliveryRouteItem(row.routeLegacyId ?? row.route_legacy_id, row.orderLegacyId ?? row.order_legacy_id); return true;
    }
    return false;
  }

  function makeOrderTombstone(row) {
    const id = rawIdentity(row);
    if (!id) return null;
    const now = new Date().toISOString();
    return { id, legacy_id: id, deleted: true, archivedAt: now, deletedAt: now, updatedAt: now, createdAt: row?.createdAt ?? row?.created_at ?? now, legacy_payload: clone(row) };
  }

  function rebuildDerivedMembership(state) {
    const groups = Array.isArray(state.orderGroups) ? state.orderGroups : [];
    const routes = Array.isArray(state.deliveryRoutes) ? state.deliveryRoutes : [];
    const groupMap = new Map(groups.map((g) => [String(g.id), g]));
    const routeMap = new Map(routes.map((r) => [String(r.id), r]));
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

  async function firstCanonicalSync(auth) {
    const baseline = readBaseline();
    if (baseline?.version === 2 && baseline?.companyId === auth?.profile?.company_id && baseline?.savedAt) return false;

    const resources = supportedResources();
    const remote = await fetchRemoteSet(resources);
    const current = stateSnapshot();
    if (!current) throw new Error("Application state is unavailable for canonical initialization.");
    const next = clone(current);
    let changed = false;

    for (const resource of resources) {
      const stateName = resourceStateName(resource);
      const localRows = Array.isArray(current[stateName]) ? current[stateName] : [];
      const remoteRows = remote[resource] || [];
      const localMap = index(localRows);
      const remoteMap = index(remoteRows);
      const merged = new Map(remoteMap);

      // On an uninitialized device, never discard a local record merely because
      // another record exists remotely. Local-only records are preserved and
      // explicitly uploaded; records already present remotely remain canonical.
      for (const [key, row] of localMap) {
        if (!remoteMap.has(key)) {
          merged.set(key, row);
          await window.GVData.upsertResource(resource, [row]);
          changed = true;
        }
      }

      next[stateName] = [...merged.values()];
      if (stableJson(next[stateName]) !== stableJson(localRows)) changed = true;
    }

    // Re-read the cloud after bootstrap writes so the baseline contains only
    // canonical gateway-shaped rows actually stored by Supabase.
    const canonical = await fetchRemoteSet(resources);
    for (const resource of resources) next[resourceStateName(resource)] = canonical[resource] || [];
    rebuildDerivedMembership(next);

    committing = true;
    try {
      replaceState(next);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(next);
      writeBaseline(next, auth?.profile?.company_id);
    } finally { committing = false; }

    setMeta({ type: "initial-canonical-sync", status: "synced", changed, companyId: auth?.profile?.company_id || null });
    if (changed) scheduleRender();
    return changed;
  }

  async function reconcileResource(resource, localRows, remoteRows, baselineRows, remoteTombstones, nextState) {
    const localMap = index(localRows), remoteMap = index(remoteRows), baselineMap = index(baselineRows);
    const tombstones = resource === "orders" ? (() => { const m = new Map(); for (const row of remoteTombstones || []) { const id = rawIdentity(row); if (id) m.set(`legacy:${id}`, row); } return m; })() : new Map();
    const keys = new Set([...localMap.keys(), ...remoteMap.keys(), ...baselineMap.keys(), ...tombstones.keys()]);
    const resolved = new Map(), localWrites = [], deletes = [], tombstonesToRemove = [];
    let changed = false;

    for (const key of keys) {
      const localRow = localMap.get(key), remoteRow = remoteMap.get(key), baselineRow = baselineMap.get(key), remoteTombstone = tombstones.get(key);
      const remoteEffective = remoteRow || (remoteTombstone ? { ...remoteTombstone } : undefined);
      const localChanged = localRow !== undefined ? (!baselineRow || !rowsEqual(localRow, baselineRow)) : Boolean(baselineRow);
      const remoteChanged = remoteEffective !== undefined ? (!baselineRow || !rowsEqual(remoteEffective, baselineRow)) : Boolean(baselineRow);
      let winner = "remote";

      if (localChanged && !remoteChanged) winner = localRow ? "local" : "delete-local";
      else if (!localChanged && remoteChanged) winner = remoteRow ? "remote" : "delete-local";
      else if (localChanged && remoteChanged) {
        winner = localRow && remoteEffective ? chooseWinner(localRow, remoteEffective) : (localRow ? "local" : "delete-local");
      } else if (localRow && !remoteEffective && !baselineRow) winner = "local";
      else if (!localRow && remoteEffective && !baselineRow) winner = remoteRow ? "remote" : "delete-local";
      else if (!localRow && !remoteEffective) winner = "delete-local";

      if (winner === "local" && localRow) {
        localWrites.push(localRow);
        resolved.set(key, localRow);
        if (remoteTombstone) tombstonesToRemove.push(remoteTombstone);
      } else if (winner === "remote" && remoteRow) {
        resolved.set(key, remoteRow);
        if (!localRow || !rowsEqual(localRow, remoteRow)) changed = true;
      } else if (winner === "delete-local") {
        if (localRow) changed = true;
        if (remoteRow && baselineRow && !localRow && !remoteChanged) deletes.push({ resource, row: remoteRow });
      } else if (winner === "remote" && remoteTombstone) {
        if (localRow) changed = true;
      }
    }

    if (resource === "orders") {
      for (const item of deletes) {
        const tombstone = makeOrderTombstone(item.row);
        if (tombstone) await window.GVData.upsertResource("deleted_orders", [tombstone]);
      }
      for (const tombstone of tombstonesToRemove) {
        try { await window.GVData.deleteResourceByLegacyId("deleted_orders", rawIdentity(tombstone)); } catch (_) {}
      }
    }

    for (const row of localWrites) await window.GVData.upsertResource(resource, [row]);
    for (const item of deletes) if (!await deleteRemote(resource, item.row)) throw new Error(`No deletion adapter for ${resource}.`);
    if (nextState) nextState[resourceStateName(resource)] = [...resolved.values()];
    return { changed, writes: localWrites.length, deletes: deletes.length };
  }

  async function flush(reason = "poll") {
    if (committing) return { ok: false, status: "commit-in-progress" };
    if (inFlight) return inFlight;
    if (!navigator.onLine) return { ok: false, status: "offline" };
    if (!window.GVAuth?.isAuthorized?.()) return { ok: false, status: "unauthorized" };
    if (interactionActive() && reason === "poll") { deferredSync = true; return { ok: false, status: "deferred-for-interaction" }; }

    inFlight = (async () => {
      const auth = await requireManager();
      const resources = supportedResources();
      const baseline = readBaseline();
      if (baseline?.companyId && baseline.companyId !== auth?.profile?.company_id) writeJson(BASELINE_KEY, { version: 2, companyId: auth.profile.company_id, savedAt: 0, state: {} });
      const current = stateSnapshot();
      if (!current) throw new Error("Application state snapshot is unavailable.");
      if (!readBaseline()?.savedAt) return { ok: true, status: "initialized", changed: await firstCanonicalSync(auth) };

      const currentBaseline = readBaseline();
      const nextState = clone(current);
      let stateChanged = false;
      let writes = 0;
      let deletes = 0;
      const failures = [];
      const fetched = await fetchRemoteSet(resources);
      const remoteTombstones = fetched.deleted_orders || [];

      for (const resource of resources) {
        const stateName = resourceStateName(resource);
        const localRows = Array.isArray(current[stateName]) ? current[stateName] : [];
        const baselineRows = Array.isArray(currentBaseline.state?.[stateName]) ? currentBaseline.state[stateName] : [];
        const remoteRows = Array.isArray(fetched[resource]) ? fetched[resource] : [];
        try {
          const result = await reconcileResource(resource, localRows, remoteRows, baselineRows, remoteTombstones, nextState);
          writes += result.writes;
          deletes += result.deletes;
          if (result.changed) stateChanged = true;
        } catch (error) {
          failures.push({ resource, error: String(error?.message || error) });
          nextState[stateName] = localRows;
        }
      }

      const canonical = await fetchRemoteSet(resources);
      for (const resource of resources) {
        const stateName = resourceStateName(resource);
        if (failures.some((item) => item.resource === resource)) nextState[stateName] = Array.isArray(current[stateName]) ? current[stateName] : [];
        else nextState[stateName] = canonical[resource] || [];
      }

      rebuildDerivedMembership(nextState);
      const companyId = auth?.profile?.company_id || null;
      committing = true;
      try {
        if (stableJson(nextState) !== stableJson(current)) stateChanged = true;
        replaceState(nextState);
        if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);
        if (!failures.length) writeBaseline(nextState, companyId);
      } finally { committing = false; }

      const status = failures.length ? "partial" : "synced";
      setMeta({ status, reason, companyId, stateChanged, writes, deletes, failures, lastSyncAt: new Date().toISOString() });
      if (stateChanged) scheduleRender();
      return { ok: failures.length === 0, status, stateChanged, writes, deletes, failures };
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

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => flush("poll").catch(() => {}), POLL_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function installPersistenceWakeup() {
    if (localWriteHookInstalled || typeof window.persistState !== "function") return;
    const original = window.persistState;
    window.persistState = function (...args) {
      const result = original.apply(this, args);
      if (!committing && window.GVAuth?.isAuthorized?.()) setTimeout(() => flush("local-mutation").catch(() => {}), 0);
      return result;
    };
    localWriteHookInstalled = true;
  }

  function bindLifecycle() {
    if (initialized) return;
    initialized = true;
    window.addEventListener("gv-auth-state-changed", (event) => {
      if (event?.detail?.authenticated === true) { schedule(); flush("auth").catch(() => {}); }
      else stop();
    });
    window.addEventListener("online", () => flush("online").catch(() => {}));
    window.addEventListener("focus", () => flush("focus").catch(() => {}));
    window.addEventListener("pageshow", () => flush("pageshow").catch(() => {}));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flush("visible").catch(() => {}); });
    document.addEventListener("focusout", () => { if (deferredSync && !interactionActive()) { deferredSync = false; flush("interaction-release").catch(() => {}); } }, true);
    setTimeout(installPersistenceWakeup, 0);
  }

  window.GVSync = Object.freeze({
    flush,
    poll: () => flush("poll"),
    request: (reason = "request") => flush(reason),
    startPolling: schedule,
    stopPolling: stop,
    getBaseline: readBaseline,
    meta: () => readJson(META_KEY, {}),
    resetBaseline: () => writeJson(BASELINE_KEY, { version: 2, companyId: null, savedAt: 0, state: {} })
  });

  window.syncChangedResources = () => window.GVSync.flush("legacy-entry");
  window.syncNow = () => window.GVSync.flush("manual");

  window.addEventListener("DOMContentLoaded", () => {
    bindLifecycle();
    setTimeout(() => {
      installPersistenceWakeup();
      if (window.GVAuth?.isAuthorized?.()) { schedule(); flush("startup").catch(() => {}); }
    }, 0);
  }, { once: true });
})();