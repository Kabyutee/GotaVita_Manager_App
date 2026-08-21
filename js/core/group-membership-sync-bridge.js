/* GotaVita Manager — Group membership synchronization bridge.
 * Keeps the legacy parent model (orderGroups[].orderIds) and the canonical
 * child resource (orderGroupItems[]) synchronized before persistence and
 * after remote synchronization.
 */
(function () {
  "use strict";

  function stateSnapshot() {
    try { return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null; }
    catch (_) { return null; }
  }

  function replaceState(snapshot) {
    try { if (typeof window.replaceState === "function") window.replaceState(snapshot); }
    catch (error) { console.warn("GotaVita group membership state replace:", error?.message || error); }
  }

  function stableItemId(groupId, orderId) {
    return `group_item_${String(groupId)}_${String(orderId)}`;
  }

  function rebuildOrderGroupItems(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.orderGroups)) return snapshot;
    const previous = Array.isArray(snapshot.orderGroupItems) ? snapshot.orderGroupItems : [];
    const previousByKey = new Map(
      previous
        .filter((item) => item && item.groupLegacyId != null && item.orderLegacyId != null)
        .map((item) => [`${item.groupLegacyId}::${item.orderLegacyId}`, item])
    );
    const next = [];
    for (const group of snapshot.orderGroups) {
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
    snapshot.orderGroupItems = next;
    return snapshot;
  }

  function rebuildOrderGroupIdsFromItems(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.orderGroups)) return snapshot;
    const items = Array.isArray(snapshot.orderGroupItems) ? snapshot.orderGroupItems : [];
    const byGroup = new Map();
    for (const item of items) {
      if (!item || item.groupLegacyId == null || item.orderLegacyId == null) continue;
      const key = String(item.groupLegacyId);
      if (!byGroup.has(key)) byGroup.set(key, []);
      const orderId = String(item.orderLegacyId);
      if (!byGroup.get(key).includes(orderId)) byGroup.get(key).push(orderId);
    }
    for (const group of snapshot.orderGroups) {
      if (!group || group.id == null) continue;
      group.orderIds = byGroup.get(String(group.id)) || [];
    }
    return snapshot;
  }

  function installPersistBridge() {
    if (window.__GV_GROUP_MEMBERSHIP_PERSIST_BRIDGE_INSTALLED) return true;
    if (typeof window.persistState !== "function") return false;
    const originalPersistState = window.persistState;
    window.persistState = function groupMembershipAwarePersistState(...args) {
      const snapshot = stateSnapshot();
      if (snapshot) {
        rebuildOrderGroupItems(snapshot);
        replaceState(snapshot);
      }
      return originalPersistState.apply(this, args);
    };
    window.__GV_GROUP_MEMBERSHIP_PERSIST_BRIDGE_INSTALLED = true;
    return true;
  }

  function installSyncBridge() {
    if (window.__GV_GROUP_MEMBERSHIP_SYNC_BRIDGE_INSTALLED) return true;
    if (!window.GVSync || typeof window.GVSync.flush !== "function") return false;
    const originalFlush = window.GVSync.flush;
    window.GVSync.flush = async function groupMembershipAwareFlush(...args) {
      const result = await originalFlush.apply(this, args);
      const snapshot = stateSnapshot();
      if (snapshot) {
        const before = JSON.stringify(snapshot.orderGroups || []);
        rebuildOrderGroupIdsFromItems(snapshot);
        if (before !== JSON.stringify(snapshot.orderGroups || [])) {
          replaceState(snapshot);
          try { if (typeof window.GVSync.render === "function") window.GVSync.render(); } catch (_) {}
        }
      }
      return result;
    };
    window.__GV_GROUP_MEMBERSHIP_SYNC_BRIDGE_INSTALLED = true;
    return true;
  }

  function install() {
    installPersistBridge();
    installSyncBridge();
  }

  window.GVGroupMembershipBridge = Object.freeze({
    rebuildOrderGroupItems,
    rebuildOrderGroupIdsFromItems,
    install
  });

  install();
  document.addEventListener("DOMContentLoaded", install, { once: true });
})();
