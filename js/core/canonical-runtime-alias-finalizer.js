/* GotaVita Manager — Canonical Sync v2 runtime alias finalizer.
 *
 * script.js still contains historical synchronization functions for source-level
 * compatibility. Because those functions are global declarations, they can
 * overwrite aliases installed by sync-manager.js when script.js is evaluated
 * afterward. This finalizer runs last and restores the canonical public
 * synchronization boundaries without creating a second coordinator.
 */
(function () {
  "use strict";

  if (!window.GVSync?.flush) return;

  window.syncChangedResources = (reason) =>
    window.GVSync.flush(reason || "legacy-entry");

  window.syncNow = () =>
    window.GVSync.flush("manual");

  window.startSyncReliability = () => {};
  window.initSyncReliability = () => {};

  // Compatibility-only bridge for older code that still reads window.state.
  // This is a getter backed by the canonical snapshot boundary, so no second
  // mutable application-state object is introduced and replacements remain visible.
  try {
    Object.defineProperty(window, "state", {
      configurable: true,
      enumerable: false,
      get: () =>
        typeof window.getStateSnapshot === "function"
          ? window.getStateSnapshot()
          : null
    });
  } catch (_) {}

  /*
   * Canonical membership persistence guard.
   *
   * orderGroups[].orderIds is a derived presentation field in Sync v2. The
   * authoritative membership resource is orderGroupItems[]. When legacy
   * feature handlers edit orderIds, reconcile that projection back into the
   * authoritative child-resource array immediately before persistState() takes
   * its local snapshot. This lets GVSync dirty-detect and synchronize the
   * actual order_group_items rows without changing the business-module API.
   */
  function reconcileGroupMembershipForPersistence() {
    if (typeof window.getStateSnapshot !== "function" || typeof window.replaceState !== "function") return;

    const snapshot = window.getStateSnapshot();
    if (!snapshot || typeof snapshot !== "object") return;

    const groups = Array.isArray(snapshot.orderGroups) ? snapshot.orderGroups : [];
    const orders = Array.isArray(snapshot.orders) ? snapshot.orders : [];
    const existingItems = Array.isArray(snapshot.orderGroupItems) ? snapshot.orderGroupItems : [];
    const orderIds = new Set(orders.map((order) => String(order?.id ?? "")).filter(Boolean));
    const byMembership = new Map();

    for (const item of existingItems) {
      const groupId = String(item?.groupLegacyId ?? item?.group_legacy_id ?? item?.groupId ?? "");
      const orderId = String(item?.orderLegacyId ?? item?.order_legacy_id ?? item?.orderId ?? "");
      if (!groupId || !orderId) continue;
      byMembership.set(`${groupId}::${orderId}`, item);
    }

    const desired = new Map();
    for (const group of groups) {
      let groupId = String(group?.id ?? "").trim();
      if (!groupId) {
        groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        group.id = groupId;
      }

      for (const rawOrderId of Array.isArray(group?.orderIds) ? group.orderIds : []) {
        const orderId = String(rawOrderId ?? "").trim();
        if (!orderId || !orderIds.has(orderId)) continue;
        const key = `${groupId}::${orderId}`;
        const existing = byMembership.get(key);
        desired.set(key, existing || {
          id: `group_item_${groupId}_${orderId}`,
          groupLegacyId: groupId,
          orderLegacyId: orderId,
          createdAt: new Date().toISOString()
        });
      }
    }

    const nextItems = [...desired.values()];
    const currentComparable = existingItems.map((item) => ({
      groupLegacyId: String(item?.groupLegacyId ?? item?.group_legacy_id ?? item?.groupId ?? ""),
      orderLegacyId: String(item?.orderLegacyId ?? item?.order_legacy_id ?? item?.orderId ?? "")
    })).sort((a, b) => `${a.groupLegacyId}::${a.orderLegacyId}`.localeCompare(`${b.groupLegacyId}::${b.orderLegacyId}`));
    const nextComparable = nextItems.map((item) => ({
      groupLegacyId: String(item.groupLegacyId),
      orderLegacyId: String(item.orderLegacyId)
    })).sort((a, b) => `${a.groupLegacyId}::${a.orderLegacyId}`.localeCompare(`${b.groupLegacyId}::${b.orderLegacyId}`));

    if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable) && snapshot.orderGroupItems) return;
    snapshot.orderGroupItems = nextItems;
    window.replaceState(snapshot);
  }

  window.reconcileGroupMembershipForPersistence = reconcileGroupMembershipForPersistence;

  try {
    if (typeof window.persistState === "function" && !window.persistState.__gvGroupMembershipGuarded) {
      const originalPersistState = window.persistState;
      const guardedPersistState = function (...args) {
        try {
          reconcileGroupMembershipForPersistence();
        } catch (error) {
          console.warn("GotaVita group membership reconciliation skipped:", error?.message || error);
        }
        return originalPersistState.apply(this, args);
      };
      guardedPersistState.__gvGroupMembershipGuarded = true;
      window.persistState = guardedPersistState;
    }
  } catch (_) {}

  try {
    if (typeof window.stopSyncReliability === "function") {
      window.stopSyncReliability();
    }
  } catch (_) {}
})();
