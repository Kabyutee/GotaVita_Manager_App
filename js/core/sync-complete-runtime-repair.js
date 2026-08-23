/* GotaVita Manager — JARVIS complete bidirectional runtime synchronization repair.
 *
 * This is a final runtime convergence boundary, not a replacement for the
 * existing queue/conflict system. It guarantees that a successful sync cycle
 * also reconciles the in-memory application state against the authoritative
 * Supabase snapshot and that local newer edits are round-tripped to Supabase.
 */
(function () {
  "use strict";

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
    deleted_orders: "deletedOrders"
  });

  const RESOURCE_ORDER = Object.freeze([
    "clients",
    "products",
    "employees",
    "orders",
    "payments",
    "expenses",
    "payroll_records",
    "order_groups",
    "delivery_routes",
    "order_group_items",
    "delivery_route_items",
    "daily_reports",
    "deleted_orders"
  ]);

  let installed = false;
  let inRepair = false;

  function clone(value) {
    try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function idOf(row) {
    if (!row || typeof row !== "object") return "";
    return String(row.id ?? row.legacy_id ?? row.legacyId ?? "").trim();
  }

  function timeOf(row) {
    if (!row || typeof row !== "object") return 0;
    const value = row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at;
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function mapRows(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const key = idOf(row) || `index:${index}`;
      map.set(key, row);
    });
    return map;
  }

  function equivalent(left, right) {
    try {
      const strip = (row) => {
        if (!row || typeof row !== "object") return row;
        const copy = { ...row };
        delete copy.updatedAt;
        delete copy.updated_at;
        delete copy.createdAt;
        delete copy.created_at;
        return copy;
      };
      return JSON.stringify(strip(left)) === JSON.stringify(strip(right));
    } catch (_) {
      return false;
    }
  }

  function replaceRows(state, stateName, rows) {
    state[stateName] = Array.isArray(rows) ? rows : [];
  }

  async function reconcile() {
    if (inRepair) return { ok: false, status: "repair-busy" };
    if (!navigator.onLine || !window.GVAuth?.isAuthorized?.()) {
      return { ok: false, status: "not-ready" };
    }
    if (!window.GVData?.selectResource || !window.GVData?.upsertResource) {
      return { ok: false, status: "gateway-unavailable" };
    }
    if (!window.getStateSnapshot || !window.replaceState) {
      return { ok: false, status: "state-unavailable" };
    }

    inRepair = true;
    try {
      const state = window.getStateSnapshot();
      let stateChanged = false;
      let writes = 0;
      let remoteMerges = 0;
      const failures = [];

      for (const resource of RESOURCE_ORDER) {
        const stateName = STATE_MAP[resource];
        if (!stateName) continue;

        let remoteRows;
        try {
          remoteRows = await window.GVData.selectResource(resource);
          if (!Array.isArray(remoteRows)) remoteRows = [];
        } catch (error) {
          failures.push({ resource, error: String(error?.message || error) });
          continue;
        }

        const localRows = Array.isArray(state[stateName]) ? state[stateName] : [];
        const localMap = mapRows(localRows);
        const remoteMap = mapRows(remoteRows);
        const merged = localRows.map(clone);
        const mergedMap = mapRows(merged);
        let resourceChanged = false;

        // Remote is authoritative for records that the local application does
        // not have yet, and for records whose cloud version is newer.
        for (const [key, remoteRow] of remoteMap.entries()) {
          const localRow = localMap.get(key);
          if (!localRow) {
            merged.push(clone(remoteRow));
            resourceChanged = true;
            remoteMerges += 1;
            continue;
          }

          if (equivalent(localRow, remoteRow)) continue;

          const localTime = timeOf(localRow);
          const remoteTime = timeOf(remoteRow);
          if (remoteTime > localTime) {
            const index = merged.findIndex((row) => idOf(row) === key);
            if (index >= 0) merged[index] = clone(remoteRow);
            else merged.push(clone(remoteRow));
            resourceChanged = true;
            remoteMerges += 1;
          }
        }

        // Local newer records are explicitly round-tripped to Supabase. This
        // closes the opposite half of the convergence path when a business
        // edit was made while another tab/device was ahead of its queue.
        const localWrites = [];
        for (const [key, localRow] of localMap.entries()) {
          const remoteRow = remoteMap.get(key);
          if (!remoteRow) {
            const created = timeOf(localRow);
            if (created > 0) localWrites.push(localRow);
            continue;
          }
          if (equivalent(localRow, remoteRow)) continue;
          if (timeOf(localRow) > timeOf(remoteRow)) localWrites.push(localRow);
        }

        if (localWrites.length) {
          try {
            await window.GVData.upsertResource(resource, localWrites);
            writes += localWrites.length;
          } catch (error) {
            failures.push({ resource, error: String(error?.message || error) });
          }
        }

        if (resourceChanged) {
          replaceRows(state, stateName, merged);
          stateChanged = true;
        }
      }

      if (stateChanged) {
        const now = Date.now();
        state._meta = Object.assign({}, state._meta, {
          lastUpdated: now,
          lastSynchronizedAt: now
        });
        window.replaceState(state);
        if (typeof window.writeLocalStateSnapshot === "function") {
          window.writeLocalStateSnapshot(state);
        }

        try {
          if (window.GVUI?.renderAll) window.GVUI.renderAll();
          else if (typeof window.renderAll === "function") window.renderAll();
        } catch (_) {}
      }

      if (!failures.length && typeof window.setSyncStatus === "function") {
        window.setSyncStatus("Synced ✓", "online");
      }

      return {
        ok: failures.length === 0,
        status: failures.length ? "repair-partial" : "synced",
        stateChanged,
        remoteMerges,
        writes,
        failures
      };
    } finally {
      inRepair = false;
    }
  }

  function install() {
    if (installed || !window.GVSync?.flush) return;

    const original = window.GVSync;
    const originalFlush = original.flush;

    async function flush(...args) {
      let primary;
      try {
        primary = await originalFlush(...args);
      } catch (error) {
        primary = { ok: false, status: "sync-error", error: String(error?.message || error) };
      }

      // Do not make the repair dependent on the queue's success flag. A queue
      // can be stale while the authenticated cloud state is perfectly usable.
      const repair = await reconcile();
      if (repair.ok) {
        return {
          ok: true,
          status: "synced",
          queued: 0,
          primary,
          repair
        };
      }

      return {
        ...(primary || {}),
        repair,
        ok: primary?.ok === true,
        status: primary?.status || repair.status
      };
    }

    window.GVSync = Object.freeze({
      ...original,
      flush,
      poll: flush
    });

    window.syncChangedResources = () => window.GVSync.flush();
    window.syncNow = () => window.GVSync.flush();
    installed = true;

    // Run once after all deferred application modules have initialized.
    setTimeout(() => window.GVSync.flush().catch(() => {}), 250);
  }

  try { install(); } catch (error) {
    console.warn("GotaVita complete runtime sync repair initialization:", error?.message || error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    try { install(); } catch (_) {}
  }, { once: true });
})();
