/* GotaVita Manager — Priority-0 master-data auth hydration boundary. */
(function () {
  "use strict";

  const P0 = Object.freeze(["clients", "employees", "products"]);
  let inFlight = false;

  function keyOf(row, index) {
    if (!row || typeof row !== "object") return `index:${index}`;
    const value = row.legacy_id ?? row.legacyId ?? row.id;
    return value == null ? `index:${index}` : String(value).trim();
  }

  function sameRow(a, b) {
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
      return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
    } catch (_) {
      return false;
    }
  }

  function hasPending(resource) {
    try {
      const queue = typeof window.getSyncQueue === "function" ? window.getSyncQueue() : [];
      return Array.isArray(queue) && queue.some((item) => String(item ?? "").trim() === resource);
    } catch (_) {
      return false;
    }
  }

  async function hydrate() {
    if (inFlight) return { ok: false, status: "busy" };
    if (window.GVAuth?.isAuthorized?.() !== true) return { ok: false, status: "unauthorized" };
    if (!window.GVData?.selectResource || typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") {
      return { ok: false, status: "unavailable" };
    }

    inFlight = true;
    try {
      const nextState = window.getStateSnapshot();
      const changedResources = [];

      for (const resource of P0) {
        if (hasPending(resource)) continue;

        let remoteRows = await window.GVData.selectResource(resource);
        if (!Array.isArray(remoteRows)) remoteRows = [];

        const localRows = Array.isArray(nextState[resource]) ? nextState[resource] : [];

        // P0 is fail-closed: a smaller or empty passive cloud snapshot can never
        // erase populated local master data during authentication hydration.
        if (remoteRows.length < localRows.length) continue;

        const localMap = new Map(localRows.map((row, index) => [keyOf(row, index), row]));
        const nextRows = localRows.slice();

        for (const [index, remoteRow] of remoteRows.entries()) {
          const key = keyOf(remoteRow, index);
          const localRow = localMap.get(key);
          const localIndex = nextRows.findIndex((row, rowIndex) => keyOf(row, rowIndex) === key);
          if (!localRow || !sameRow(localRow, remoteRow)) {
            if (localIndex >= 0) nextRows[localIndex] = remoteRow;
            else nextRows.push(remoteRow);
          }
        }

        if (JSON.stringify(nextRows) !== JSON.stringify(localRows)) {
          nextState[resource] = nextRows;
          changedResources.push(resource);
        }
      }

      if (!changedResources.length) return { ok: true, status: "no-diff", resources: [] };

      const now = Date.now();
      nextState._meta = Object.assign({}, nextState._meta, {
        lastUpdated: now,
        lastSynchronizedAt: now,
        p0AuthHydratedAt: now
      });

      window.replaceState(nextState);
      if (typeof window.writeLocalStateSnapshot === "function") window.writeLocalStateSnapshot(nextState);
      try {
        if (window.GVUI?.renderAll) window.GVUI.renderAll();
        else if (typeof window.renderAll === "function") window.renderAll();
      } catch (_) {}

      return { ok: true, status: "hydrated", resources: changedResources };
    } catch (error) {
      console.warn("GotaVita P0 auth hydration:", error?.message || error);
      return { ok: false, status: "error", error: String(error?.message || error) };
    } finally {
      inFlight = false;
    }
  }

  window.GVP0AuthHydration = Object.freeze({ hydrate, resources: P0.slice() });

  const run = () => hydrate().catch(() => {});
  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) setTimeout(run, 0);
  });
  window.addEventListener("pageshow", run);
  window.addEventListener("focus", run);
})();
