/* GotaVita Manager — remote order tombstones are deletion evidence, not rows.
 * Keep canonical conflict reconciliation from resurrecting an order that has
 * already been deleted on another device.
 */
(function () {
  "use strict";

  function stableId(row) {
    if (!row || typeof row !== "object") return "";
    return String(row.legacy_id ?? row.legacyId ?? row.id ?? "").trim();
  }

  function timeOf(row) {
    if (!row || typeof row !== "object") return 0;
    const value = row.updatedAt ?? row.updated_at ?? row.archivedAt ?? row.archived_at ?? row.createdAt ?? row.created_at;
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function install() {
    if (window.__GV_ORDER_DELETE_RECONCILIATION_BRIDGE__) return true;
    if (!window.GVConflictIntegration?.buildResolutionPlan) return false;

    const originalBuild = window.GVConflictIntegration.buildResolutionPlan;
    window.GVConflictIntegration = Object.freeze({
      ...window.GVConflictIntegration,
      buildResolutionPlan: function (localRows, remoteRows, baselineAt, localDeletedRows = [], remoteDeletedRows = [], baselineRows = []) {
        const decisions = originalBuild(localRows, remoteRows, baselineAt, localDeletedRows, remoteDeletedRows, baselineRows);
        const remoteTombstones = new Map(
          (Array.isArray(remoteDeletedRows) ? remoteDeletedRows : [])
            .map((row) => [stableId(row), row])
            .filter(([id]) => id)
        );

        for (const decision of decisions) {
          const tombstone = remoteTombstones.get(decision.id);
          if (!tombstone || !decision.local) continue;

          if (timeOf(tombstone) >= timeOf(decision.local)) {
            decision.action = "remove-local";
            decision.reason = "remote-delete-tombstone-authoritative";
            decision.mutation = false;
            decision.remote = null;
          }
        }

        return decisions;
      }
    });

    window.__GV_ORDER_DELETE_RECONCILIATION_BRIDGE__ = true;
    return true;
  }

  try { install(); } catch (error) {
    console.warn("GotaVita order-delete reconciliation bridge:", error?.message || error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    try { install(); } catch (_) {}
  }, { once: true });
})();
