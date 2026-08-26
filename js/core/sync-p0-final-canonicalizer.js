/* GotaVita Manager — final P0 canonical browser-state boundary. */
(function () {
  "use strict";

  const P0 = Object.freeze(["clients", "employees", "products"]);
  const WRAPPED = "__GV_P0_FINAL_CANONICALIZER_V1";
  let installed = false;
  let inFlight = false;

  function stateName(resource) {
    return resource;
  }

  function keyOf(row, index) {
    if (!row || typeof row !== "object") return `index:${index}`;
    const value = row.legacy_id ?? row.legacyId ?? row.id;
    return value == null ? `index:${index}` : String(value).trim();
  }

  function rowComparable(row) {
    if (!row || typeof row !== "object") return row;
    const copy = { ...row };
    delete copy.updatedAt;
    delete copy.updated_at;
    delete copy.createdAt;
    delete copy.created_at;
    return copy;
  }

  function different(a, b) {
    try { return JSON.stringify(rowComparable(a)) !== JSON.stringify(rowComparable(b)); }
    catch (_) { return true; }
  }

  function queueContains(resource) {
    try {
      const queue = typeof window.getSyncQueue === "function" ? window.getSyncQueue() : [];
      return Array.isArray(queue) && queue.some((item) => {
        const value = String(item ?? "").trim();
        return value === resource || value === stateName(resource);
      });
    } catch (_) {
      return false;
    }
  }

  async function reconcile() {
    if (inFlight) return { changed: false, skipped: "busy" };
    if (window.GVAuth?.isAuthorized?.() !== true) return { changed: false, skipped: "unauthorized" };
    if (!window.GVData?.selectResource || typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") {
      return { changed: false, skipped: "unavailable" };
    }

    inFlight = true;
    try {
      const current = window.getStateSnapshot();
      let changed = false;
      const changedResources = [];

      for (const resource of P0) {
        if (queueContains(resource)) continue;

        let remoteRows = await window.GVData.selectResource(resource);
        if (!Array.isArray(remoteRows)) remoteRows = [];

        const localRows = Array.isArray(current[stateName(resource)]) ? current[stateName(resource)] : [];
        const localMap = new Map(localRows.map((row, index) => [keyOf(row, index), row]));
        const remoteMap = new Map(remoteRows.map((row, index) => [keyOf(row, index), row]));

        // Fail closed on passive P0 shrink. Missing remote rows are never inferred as deletes.
        if (remoteRows.length < localRows.length) continue;

        const nextRows = localRows.slice();
        for (const [id, remoteRow] of remoteMap.entries()) {
          const index = nextRows.findIndex((row, rowIndex) => keyOf(row, rowIndex) === id);
          const localRow = localMap.get(id);
          if (!localRow || different(localRow, remoteRow)) {
            if (index >= 0) nextRows[index] = remoteRow;
            else nextRows.push(remoteRow);
            changed = true;
          }
        }

        if (JSON.stringify(nextRows) !== JSON.stringify(localRows)) {
          current[stateName(resource)] = nextRows;
          changedResources.push(resource);
        }
      }

      if (!changed) return { changed: false, skipped: "no-diff" };

      const now = Date.now();
      current._meta = Object.assign({}, current._meta, {
        lastUpdated: now,
        lastSynchronizedAt: now
      });
      window.replaceState(current);
      if (typeof window.writeLocalStateSnapshot === "function") {
        window.writeLocalStateSnapshot(current);
      }
      try {
        if (window.GVUI?.renderAll) window.GVUI.renderAll();
        else if (typeof window.renderAll === "function") window.renderAll();
      } catch (_) {}

      if (typeof window.setSyncStatus === "function") {
        window.setSyncStatus(`P0 canonical · ${changedResources.join(", ")}`, "online");
      }
      return { changed: true, resources: changedResources };
    } finally {
      inFlight = false;
    }
  }

  function install() {
    if (installed || !window.GVSync?.flush || window.GVSync[WRAPPED]) return installed;
    const original = window.GVSync;
    const originalFlush = original.flush;
    async function flush(...args) {
      const result = await originalFlush(...args);
      const canonical = await reconcile();
      return { ...(result || {}), p0Canonical: canonical };
    }
    window.GVSync = Object.freeze({ ...original, flush, poll: flush, [WRAPPED]: true });
    window.syncChangedResources = () => window.GVSync.flush();
    window.syncNow = () => window.GVSync.flush();
    installed = true;
    return true;
  }

  const activate = () => {
    try { install(); } catch (_) {}
    if (!installed) setTimeout(activate, 25);
  };

  activate();
  window.addEventListener("DOMContentLoaded", activate, { once: true });
  window.addEventListener("focus", () => reconcile().catch(() => {}));
  window.addEventListener("pageshow", () => reconcile().catch(() => {}));
  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) reconcile().catch(() => {});
  });

  window.GVP0Canonical = Object.freeze({ reconcile, resources: P0.slice() });
})();
