/* GotaVita Manager — canonical remote state reconciliation bridge. */
(function () {
  "use strict";

  if (window.__GV_REMOTE_CANONICAL_FIELD_BRIDGE__) return;

  const TARGETS = Object.freeze(["clients", "products", "employees"]);
  const POLL_MS = 5000;
  let inFlight = false;

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function rowId(row) {
    return String(row?.id ?? "").trim();
  }

  async function reconcile() {
    if (inFlight) return false;
    if (!window.GVData?.getClient || !window.GVData?.requireAuthenticatedManager) return false;
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;

    let auth;
    try {
      auth = await window.GVData.requireAuthenticatedManager();
    } catch (_) {
      return false;
    }
    if (!auth?.authenticated) return false;

    const supabase = window.GVData.getClient();
    if (!supabase) return false;

    inFlight = true;
    try {
      const state = window.getStateSnapshot();
      let changed = false;

      for (const resource of TARGETS) {
        const localRows = Array.isArray(state[resource]) ? state[resource] : [];
        const { data, error } = await supabase.from(resource).select("*");
        if (error || !Array.isArray(data)) continue;

        const remoteByLegacyId = new Map(
          data
            .filter((row) => row?.legacy_id != null)
            .map((row) => [String(row.legacy_id), row])
        );

        const seen = new Set();
        const nextRows = localRows.map((localRow) => {
          const id = rowId(localRow);
          const remoteRow = remoteByLegacyId.get(id);
          if (!remoteRow) return localRow;

          seen.add(id);
          const mapped = typeof window.GVData.fromSupabaseRow === "function"
            ? window.GVData.fromSupabaseRow(resource, remoteRow)
            : { ...localRow };

          const next = { ...localRow, ...mapped };

          if (resource === "clients" || resource === "products") {
            next.active = remoteRow.active !== false;
          }
          if (resource === "employees") {
            next.status = remoteRow.status || "Active";
          }
          if (remoteRow.updated_at) next.updatedAt = remoteRow.updated_at;
          if (remoteRow.created_at) next.createdAt = remoteRow.created_at;
          if (remoteRow.id) next.supabaseId = remoteRow.id;

          if (JSON.stringify(localRow) !== JSON.stringify(next)) changed = true;
          return next;
        });

        // Add any remote rows that are not currently present locally.
        for (const remoteRow of data) {
          const id = String(remoteRow?.legacy_id ?? "").trim();
          if (!id || seen.has(id)) continue;

          const mapped = typeof window.GVData.fromSupabaseRow === "function"
            ? window.GVData.fromSupabaseRow(resource, remoteRow)
            : null;
          if (!mapped) continue;

          if (resource === "clients" || resource === "products") {
            mapped.active = remoteRow.active !== false;
          }
          if (resource === "employees") {
            mapped.status = remoteRow.status || "Active";
          }
          if (remoteRow.updated_at) mapped.updatedAt = remoteRow.updated_at;
          if (remoteRow.created_at) mapped.createdAt = remoteRow.created_at;
          if (remoteRow.id) mapped.supabaseId = remoteRow.id;

          nextRows.push(mapped);
          changed = true;
        }

        state[resource] = nextRows;
      }

      if (!changed) return false;

      const now = Date.now();
      state._meta = {
        ...(state._meta || {}),
        lastUpdated: now,
        lastSynchronizedAt: now
      };

      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") {
        window.writeLocalStateSnapshot(clone(state));
      }

      return true;
    } catch (error) {
      console.warn("GotaVita canonical remote reconciliation:", error?.message || error);
      return false;
    } finally {
      inFlight = false;
    }
  }

  window.GVRemoteCanonicalState = Object.freeze({ reconcile });
  window.__GV_REMOTE_CANONICAL_FIELD_BRIDGE__ = true;

  reconcile().catch(() => {});
  setInterval(() => reconcile().catch(() => {}), POLL_MS);
  window.addEventListener("gv-auth-state-changed", (event) => {
    if (event?.detail?.authenticated === true) reconcile().catch(() => {});
  });
  window.addEventListener("focus", () => reconcile().catch(() => {}));
  window.addEventListener("pageshow", () => reconcile().catch(() => {}));
})();
