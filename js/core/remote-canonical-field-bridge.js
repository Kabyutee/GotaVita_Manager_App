/* GotaVita Manager — canonical remote state reconciliation bridge. */
(function () {
  "use strict";

  if (window.__GV_REMOTE_CANONICAL_FIELD_BRIDGE__) return;

  const TARGETS = Object.freeze({
    clients: "clients",
    products: "products",
    employees: "employees"
  });
  const POLL_MS = 5000;
  let inFlight = false;

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  async function reconcile() {
    if (inFlight) return false;
    if (!window.GVAuth?.isAuthorized?.()) return false;
    const gateway = window.GVData;
    if (!gateway || typeof gateway.getClient !== "function") return false;
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return false;

    const supabase = gateway.getClient();
    if (!supabase) return false;

    inFlight = true;
    try {
      const state = window.getStateSnapshot();
      let changed = false;

      for (const resource of Object.keys(TARGETS)) {
        const stateRows = Array.isArray(state[resource]) ? state[resource] : [];
        const { data, error } = await supabase.from(resource).select("*");
        if (error || !Array.isArray(data)) continue;

        const remoteByLegacyId = new Map(
          data
            .filter((row) => row?.legacy_id != null)
            .map((row) => [String(row.legacy_id), row])
        );

        const nextRows = stateRows.map((localRow) => {
          const remoteRow = remoteByLegacyId.get(String(localRow?.id ?? ""));
          if (!remoteRow) return localRow;

          const next = { ...localRow };
          if (resource === "clients" || resource === "products") {
            const active = remoteRow.active !== false;
            if (next.active !== active) {
              next.active = active;
              changed = true;
            }
          }

          if (resource === "employees") {
            const status = remoteRow.status || "Active";
            if (next.status !== status) {
              next.status = status;
              changed = true;
            }
          }

          if (remoteRow.updated_at && next.updatedAt !== remoteRow.updated_at) {
            next.updatedAt = remoteRow.updated_at;
            changed = true;
          }
          if (remoteRow.created_at && next.createdAt !== remoteRow.created_at) {
            next.createdAt = remoteRow.created_at;
            changed = true;
          }
          if (remoteRow.id && next.supabaseId !== remoteRow.id) {
            next.supabaseId = remoteRow.id;
            changed = true;
          }

          return next;
        });

        state[resource] = nextRows;
      }

      if (!changed) return false;

      state._meta = {
        ...(state._meta || {}),
        lastUpdated: Date.now(),
        lastSynchronizedAt: Date.now()
      };

      window.replaceState(state);
      if (typeof window.writeLocalStateSnapshot === "function") {
        window.writeLocalStateSnapshot(clone(state));
      }
      if (typeof window.renderAll === "function") {
        window.renderAll();
      } else if (window.GVUI?.renderAll) {
        window.GVUI.renderAll();
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
