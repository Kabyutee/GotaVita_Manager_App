/* GotaVita Manager — ANTI BIG BANG 4.0 cloud-write reconciliation */
(function () {
  "use strict";

  const BASELINE_KEY = "gotavita_sync_baseline_v1";
  let installed = false;

  function readBaselineState() {
    try {
      const raw = window.localStorage?.getItem(BASELINE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.state && typeof parsed.state === "object" ? parsed.state : null;
    } catch (_) {
      return null;
    }
  }

  function isoTime(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function rowIsNewer(localRow, remoteRow) {
    if (!remoteRow) return true;
    return isoTime(localRow?.updatedAt || localRow?.createdAt) >
      isoTime(remoteRow?.updatedAt || remoteRow?.createdAt);
  }

  function numericOrderNumber(value) {
    const n = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function formatOrderNumber(value) {
    return String(value).padStart(7, "0");
  }

  async function selectRemoteOrders(original) {
    try {
      const rows = await original.selectResource("orders");
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  async function changedOrderRows(original, rows) {
    const localRows = Array.isArray(rows) ? rows : [];
    if (!localRows.length) return [];

    const remoteRows = await selectRemoteOrders(original);
    const remoteById = new Map(remoteRows.map((row) => [String(row.id), row]));
    const baseline = readBaselineState();
    const baselineRows = Array.isArray(baseline?.orders) ? baseline.orders : [];
    const baselineById = new Map(baselineRows.map((row) => [String(row.id), row]));

    return localRows.filter((row) => {
      const id = String(row?.id ?? "");
      const remote = remoteById.get(id);
      const baselineRow = baselineById.get(id);

      if (!remote) return true;
      if (rowIsNewer(row, remote)) return true;
      if (baselineRow && rowIsNewer(row, baselineRow)) return true;
      return false;
    });
  }

  async function reconcileOrderNumbers(original, rows) {
    const candidates = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
    if (!candidates.length) return candidates;

    const remoteRows = await selectRemoteOrders(original);
    const ownerByOrderNumber = new Map();
    const used = new Set();
    let next = 0;

    for (const row of remoteRows) {
      const number = String(row?.orderNumber || "").trim();
      if (!number) continue;
      used.add(number);
      ownerByOrderNumber.set(number, String(row.id));
      next = Math.max(next, numericOrderNumber(number));
    }

    for (const row of candidates) {
      const number = String(row?.orderNumber || "").trim();
      if (!number) continue;
      const owner = ownerByOrderNumber.get(number);
      const sameRecord = owner && owner === String(row.id);
      if (!owner || sameRecord) continue;

      do {
        next += 1;
        row.orderNumber = formatOrderNumber(next);
      } while (used.has(row.orderNumber));

      used.add(row.orderNumber);
      ownerByOrderNumber.set(row.orderNumber, String(row.id));
    }

    return candidates;
  }

  function isUniqueConflict(error) {
    const text = String(
      error?.message || error?.details || error?.hint || error || ""
    ).toLowerCase();
    return error?.code === "23505" ||
      text.includes("duplicate key") ||
      text.includes("unique constraint") ||
      text.includes("409");
  }

  async function upsertWithReconciliation(original, resource, rows) {
    if (resource !== "orders") {
      return original.upsertResource(resource, rows);
    }

    const changedRows = await changedOrderRows(original, rows);
    if (!changedRows.length) return [];

    try {
      return await original.upsertResource(resource, changedRows);
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const reconciled = await reconcileOrderNumbers(original, changedRows);
      return original.upsertResource(resource, reconciled);
    }
  }

  function install() {
    if (installed || !window.GVData) return;

    const original = window.GVData;
    if (typeof original.upsertResource !== "function") return;

    const facade = Object.assign({}, original, {
      upsertResource(resource, rows) {
        return upsertWithReconciliation(original, resource, rows);
      }
    });

    window.GVData = Object.freeze(facade);
    installed = true;
  }

  try { install(); } catch (error) {
    console.warn("GotaVita cloud-write reconciler initialization skipped:", error?.message || error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    try { install(); } catch (error) {
      console.warn("GotaVita cloud-write reconciler initialization skipped:", error?.message || error);
    }
  }, { once: true });
})();
