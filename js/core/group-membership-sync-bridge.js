/* GotaVita Manager — Group membership synchronization bridge.
 * Keeps the legacy parent model (orderGroups[].orderIds) and the canonical
 * child resource (orderGroupItems[]) synchronized before every persistence.
 */
(function () {
  "use strict";

  function stableItemId(groupId, orderId) {
    return `group_item_${String(groupId)}_${String(orderId)}`;
  }

  function rebuildOrderGroupItems() {
    if (!window.state || !Array.isArray(window.state.orderGroups)) return;
    const previous = Array.isArray(window.state.orderGroupItems)
      ? window.state.orderGroupItems
      : [];
    const previousByKey = new Map(
      previous
        .filter((item) => item && item.groupLegacyId != null && item.orderLegacyId != null)
        .map((item) => [`${item.groupLegacyId}::${item.orderLegacyId}`, item])
    );

    const next = [];
    for (const group of window.state.orderGroups) {
      if (!group || group.id == null) continue;
      const groupId = String(group.id);
      for (const orderId of Array.isArray(group.orderIds) ? group.orderIds : []) {
        if (orderId == null || String(orderId).trim() === "") continue;
        const orderLegacyId = String(orderId);
        const key = `${groupId}::${orderLegacyId}`;
        const prior = previousByKey.get(key);
        next.push({
          ...(prior || {}),
          id: prior?.id || stableItemId(groupId, orderLegacyId),
          groupLegacyId: groupId,
          orderLegacyId,
          createdAt: prior?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }
    window.state.orderGroupItems = next;
  }

  function install() {
    if (typeof window.persistState !== "function") return false;
    if (window.__GV_GROUP_MEMBERSHIP_BRIDGE_INSTALLED) return true;
    const originalPersistState = window.persistState;
    window.persistState = function groupMembershipAwarePersistState(...args) {
      try { rebuildOrderGroupItems(); } catch (error) {
        console.warn("GotaVita group membership bridge:", error?.message || error);
      }
      return originalPersistState.apply(this, args);
    };
    window.__GV_GROUP_MEMBERSHIP_BRIDGE_INSTALLED = true;
    return true;
  }

  window.GVGroupMembershipBridge = Object.freeze({ rebuildOrderGroupItems, install });

  document.addEventListener("DOMContentLoaded", () => {
    install();
    rebuildOrderGroupItems();
  }, { once: true });
})();
