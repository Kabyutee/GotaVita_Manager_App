/* GotaVita Manager — empty-cloud recovery and legacy-sync safety floor. */
(function () {
  "use strict";

  // Only resources backed by real production tables belong in recovery.
  // Audit history is intentionally excluded from business state recovery.
  const BUSINESS_RESOURCES = [
    ["clients", "clients"], ["products", "products"], ["employees", "employees"],
    ["orders", "orders"], ["payments", "payments"], ["expenses", "expenses"],
    ["payroll_records", "payrollRecords"], ["order_groups", "orderGroups"],
    ["delivery_routes", "deliveryRoutes"], ["order_group_items", "orderGroupItems"],
    ["delivery_route_items", "deliveryRouteItems"], ["daily_reports", "dailyReports"],
    ["deleted_orders", "deletedOrders"]
  ];

  const RECOVERED_ORDERS = [
    {"id":1787314372061,"date":"2026-08-21T12:12:52.061Z","notes":"","price":30,"total":630,"status":"Unpaid","address":"Masagana","gallons":21,"clientId":1785330807725,"custType":"1 Gallon (Round)","createdAt":"2026-08-21T12:12:52.061Z","productId":"p5","updatedAt":"2026-08-21T12:16:30.085Z","clientName":"E.P.","supabaseId":"d66c15a7-7439-491a-885a-3f7ef74ac878","orderNumber":"0000158","deliveryStatus":"Out for Delivery","containerBalance":1,"emptyGallonsCollected":20},
    {"id":1787314843044,"date":"2026-08-21T12:20:43.044Z","notes":"","price":30,"total":1350,"status":"Unpaid","address":"ATC - Alabang","gallons":45,"clientId":1785330449177,"custType":"1 Gallon (Round)","createdAt":"2026-08-21T12:20:43.044Z","productId":"p5","updatedAt":"2026-08-21T12:28:58.235Z","clientName":"SNR - Canteen","supabaseId":"872210e8-6bf6-4d11-929f-8e9501ad8e66","orderNumber":"0000160","deliveryStatus":"Out for Delivery","containerBalance":4,"emptyGallonsCollected":41},
    {"id":1787455703021,"date":"2026-08-23T03:28:23.021Z","notes":"","price":30,"total":990,"status":"Unpaid","address":"Festival - Alabang","gallons":33,"clientId":1785747479826,"custType":"1 Liter Bottled Water","createdAt":"2026-08-23T03:28:23.021Z","productId":"p4","updatedAt":"2026-08-24T10:07:54.442Z","clientName":"Alberto","supabaseId":"9441afaf-ccbb-4a2e-bede-66eda6589ca4","orderNumber":"0000173","deliveryStatus":"Out for Delivery","containerBalance":2,"emptyGallonsCollected":31},
    {"id":1787456305034,"date":"2026-08-23T03:38:25.034Z","notes":"","price":30,"total":390,"status":"Unpaid","address":"ATC - Alabang","gallons":13,"clientId":1785338843139,"custType":"1 Liter Bottled Water","createdAt":"2026-08-23T03:38:25.034Z","productId":"p4","updatedAt":"2026-08-23T06:34:14.296Z","clientName":"Pet Lover","orderNumber":"0000174","deliveryStatus":"Out for Delivery","containerBalance":2,"emptyGallonsCollected":11},
    {"id":1787466682091,"date":"2026-08-23T06:31:22.091Z","notes":"","price":30,"total":990,"status":"Unpaid","address":"Alabang","gallons":33,"clientId":1786274202499,"custType":"1 Liter Bottled Water","createdAt":"2026-08-23T06:31:22.091Z","productId":"p4","updatedAt":"2026-08-23T06:32:24.761Z","clientName":"Walk-In","orderNumber":"0000175","deliveryStatus":"Out for Delivery","containerBalance":2,"emptyGallonsCollected":31}
  ];

  let running = false;

  function stateSnapshot() {
    return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
  }

  function rowId(row) {
    return row?.id != null ? String(row.id) : row?.legacyId != null ? String(row.legacyId) : row?.legacy_id != null ? String(row.legacy_id) : null;
  }

  function mergeMissingRows(existing, recovered) {
    const rows = Array.isArray(existing) ? existing.slice() : [];
    const seen = new Set(rows.map(rowId).filter(Boolean));
    for (const row of Array.isArray(recovered) ? recovered : []) {
      const id = rowId(row);
      if (!id || !seen.has(id)) {
        rows.push({ ...row });
        if (id) seen.add(id);
      }
    }
    return rows;
  }

  function countBusinessRows(next) {
    return BUSINESS_RESOURCES.reduce((sum, [, stateName]) => sum + (Array.isArray(next?.[stateName]) ? next[stateName].length : 0), 0);
  }

  function updateOrderCounter(next) {
    let maxOrderNumber = Number(next?.orderCounter) || 0;
    for (const order of Array.isArray(next?.orders) ? next.orders : []) {
      const numeric = Number.parseInt(String(order?.orderNumber || "").replace(/\D/g, ""), 10);
      if (Number.isFinite(numeric)) maxOrderNumber = Math.max(maxOrderNumber, numeric);
    }
    next.orderCounter = maxOrderNumber;
  }

  function replaceAndPersist(next) {
    if (typeof window.replaceState === "function") window.replaceState(next);
    if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(next);
    if (typeof window.renderAll === "function") window.renderAll();
    else window.GVUI?.renderAll?.();
  }

  async function readCloudCounts() {
    const counts = {};
    const errors = {};
    for (const [resource] of BUSINESS_RESOURCES) {
      try {
        const rows = await window.GVData.selectResource(resource);
        counts[resource] = Array.isArray(rows) ? rows.length : 0;
      } catch (error) {
        counts[resource] = null;
        errors[resource] = String(error?.message || error);
      }
    }
    return { counts, errors };
  }

  async function loadStaticMasterData(next) {
    const response = await fetch("/GotaVita_Backup_2026_NoData_Reset.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Recovery backup HTTP ${response.status}`);
    const backup = await response.json();

    if (!Array.isArray(next.clients) || next.clients.length === 0) {
      if (Array.isArray(backup.clients) && backup.clients.length) next.clients = backup.clients;
    }
    if (!Array.isArray(next.products) || next.products.length === 0) {
      if (Array.isArray(backup.products) && backup.products.length) next.products = backup.products;
    }
    if (!Array.isArray(next.employees) || next.employees.length === 0) {
      if (Array.isArray(backup.employees) && backup.employees.length) next.employees = backup.employees;
    }
    next.orders = mergeMissingRows(next.orders, RECOVERED_ORDERS);
    updateOrderCounter(next);
    return backup;
  }

  async function promoteRecoveredState(next, cloudSnapshot) {
    const counts = cloudSnapshot.counts;
    const errors = cloudSnapshot.errors;

    const successfulCounts = Object.values(counts).filter((value) => Number.isFinite(value));
    const successfulCloudRows = successfulCounts.reduce((sum, count) => sum + count, 0);
    const hasUnknownCloudResources = Object.values(counts).some((value) => value === null);
    if (successfulCloudRows !== 0 || hasUnknownCloudResources) {
      return { attempted: false, reason: hasUnknownCloudResources ? "cloud-read-incomplete" : "cloud-not-empty", counts, errors };
    }

    const localRows = countBusinessRows(next);
    if (localRows === 0) return { attempted: false, reason: "no-local-recovery-data", counts, errors };

    const pushed = [];
    const failures = {};
    for (const [resource, stateName] of BUSINESS_RESOURCES) {
      const rows = Array.isArray(next?.[stateName]) ? next[stateName] : [];
      if (!rows.length) continue;
      try {
        await window.GVData.upsertResource(resource, rows);
        pushed.push(resource);
      } catch (error) {
        failures[resource] = String(error?.message || error);
      }
    }

    const now = Date.now();
    next._meta = Object.assign({}, next._meta, {
      lastUpdated: now,
      lastSynchronizedAt: now,
      emergencyRecoveryAt: now,
      emergencyRecoveryStatus: Object.keys(failures).length ? "partial" : "complete",
      emergencyRecoveryPushedResources: pushed,
      emergencyRecoveryFailures: failures,
      emergencyRecoveryReadErrors: errors,
      emergencyRecoveryRecoveredOrders: RECOVERED_ORDERS.length
    });
    replaceAndPersist(next);

    return { attempted: true, pushed, failures, counts, errors };
  }

  async function run() {
    if (running || window.__GV_APP_READY !== true || window.GVAuth?.isAuthorized?.() !== true) return;
    if (!window.GVData?.selectResource || !window.GVData?.upsertResource) return;

    running = true;
    try {
      const next = stateSnapshot();
      if (!next) return;

      const cloudSnapshot = await readCloudCounts();
      const successfulCounts = Object.values(cloudSnapshot.counts).filter((value) => Number.isFinite(value));
      const successfulCloudRows = successfulCounts.reduce((sum, count) => sum + count, 0);
      const hasUnknownCloudResources = Object.values(cloudSnapshot.counts).some((value) => value === null);
      if (successfulCloudRows !== 0 || hasUnknownCloudResources) return;

      await loadStaticMasterData(next);
      await promoteRecoveredState(next, cloudSnapshot);
    } catch (error) {
      console.warn("GotaVita emergency recovery preserved local state:", error?.message || error);
    } finally {
      running = false;
    }
  }

  window.GVEmergencyRecovery = Object.freeze({ run, recoveredOrderCount: RECOVERED_ORDERS.length });

  window.addEventListener("gv-app-ready", () => setTimeout(() => run().catch(() => {}), 0), { once: true });
  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true && window.__GV_APP_READY === true) setTimeout(() => run().catch(() => {}), 0);
  });
  if (window.__GV_APP_READY === true && window.GVAuth?.isAuthorized?.()) setTimeout(() => run().catch(() => {}), 0);
})();