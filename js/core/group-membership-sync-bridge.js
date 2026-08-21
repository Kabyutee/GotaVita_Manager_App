/* GotaVita Manager — Group membership synchronization bridge.
 * Maintains a two-way invariant between:
 *   orderGroups[].orderIds  <->  orderGroupItems[]
 * The side that changed since the previous persistence snapshot is treated
 * as authoritative, preventing stale remote child rows from resurrecting a
 * locally removed order.
 */
(function () {
  "use strict";

  let lastParentDigest = "";
  let lastItemsDigest = "";

  function stateSnapshot() {
    try { return typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null; }
    catch (_) { return null; }
  }

  function replaceState(snapshot) {
    try { if (typeof window.replaceState === "function") window.replaceState(snapshot); }
    catch (error) { console.warn("GotaVita group membership state replace:", error?.message || error); }
  }

  function digest(value) {
    try { return JSON.stringify(value ?? []); } catch (_) { return ""; }
  }

  function stableItemId(groupId, orderId) {
    return `group_item_${String(groupId)}_${String(orderId)}`;
  }

  function buildItemsFromGroups(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.orderGroups)) return [];
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
    return next;
  }

  function applyItemsToGroups(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.orderGroups)) return;
    const items = Array.isArray(snapshot.orderGroupItems) ? snapshot.orderGroupItems : [];
    const byGroup = new Map();
    for (const item of items) {
      if (!item || item.groupLegacyId == null || item.orderLegacyId == null) continue;
      const groupId = String(item.groupLegacyId);
      const orderId = String(item.orderLegacyId);
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      if (!byGroup.get(groupId).includes(orderId)) byGroup.get(groupId).push(orderId);
    }
    for (const group of snapshot.orderGroups) {
      if (!group || group.id == null) continue;
      group.orderIds = byGroup.get(String(group.id)) || [];
    }
  }

  function membershipEquivalent(snapshot) {
    const expectedItems = buildItemsFromGroups(snapshot);
    const actualItems = Array.isArray(snapshot?.orderGroupItems) ? snapshot.orderGroupItems : [];
    const expectedKeys = expectedItems.map((item) => `${item.groupLegacyId}::${item.orderLegacyId}`).sort();
    const actualKeys = actualItems
      .filter((item) => item && item.groupLegacyId != null && item.orderLegacyId != null)
      .map((item) => `${item.groupLegacyId}::${item.orderLegacyId}`)
      .sort();
    return JSON.stringify(expectedKeys) === JSON.stringify(actualKeys);
  }

  function reconcile(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.orderGroups)) return snapshot;
    if (!Array.isArray(snapshot.orderGroupItems)) snapshot.orderGroupItems = [];

    const parentDigest = digest(snapshot.orderGroups);
    const itemsDigest = digest(snapshot.orderGroupItems);
    const parentChanged = parentDigest !== lastParentDigest;
    const itemsChanged = itemsDigest !== lastItemsDigest;

    if (parentChanged && !itemsChanged) {
      snapshot.orderGroupItems = buildItemsFromGroups(snapshot);
    } else if (!parentChanged && itemsChanged) {
      applyItemsToGroups(snapshot);
    } else if (!snapshot.orderGroupItems.length && snapshot.orderGroups.some((group) => (group.orderIds || []).length)) {
      snapshot.orderGroupItems = buildItemsFromGroups(snapshot);
    } else if (snapshot.orderGroupItems.length && snapshot.orderGroups.every((group) => !(group.orderIds || []).length)) {
      applyItemsToGroups(snapshot);
    }

    lastParentDigest = digest(snapshot.orderGroups);
    lastItemsDigest = digest(snapshot.orderGroupItems);
    return snapshot;
  }

  function reconcileCurrentState() {
    const snapshot = stateSnapshot();
    if (!snapshot) return false;
    reconcile(snapshot);
    replaceState(snapshot);
    return true;
  }

  function reconcileRemoteState(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.orderGroups)) return false;
    if (!Array.isArray(snapshot.orderGroupItems)) snapshot.orderGroupItems = [];

    const beforeParentDigest = lastParentDigest;
    const beforeItemsDigest = lastItemsDigest;
    reconcile(snapshot);

    const parentChanged = digest(snapshot.orderGroups) !== beforeParentDigest;
    const itemsChanged = digest(snapshot.orderGroupItems) !== beforeItemsDigest;

    // A remote sync can update both resources before reconciliation runs.
    // When both sides changed and they disagree, keep the application-facing
    // parent membership authoritative and regenerate child rows from it.
    if (parentChanged && itemsChanged && !membershipEquivalent(snapshot)) {
      snapshot.orderGroupItems = buildItemsFromGroups(snapshot);
      lastParentDigest = digest(snapshot.orderGroups);
      lastItemsDigest = digest(snapshot.orderGroupItems);
    }

    return true;
  }

  function install() {
    if (window.__GV_GROUP_MEMBERSHIP_BRIDGE_INSTALLED) return true;
    const initial = stateSnapshot();
    if (initial) {
      reconcile(initial);
      replaceState(initial);
    }
    window.__GV_GROUP_MEMBERSHIP_BRIDGE_INSTALLED = true;
    return true;
  }

  window.GVGroupMembershipBridge = Object.freeze({ reconcile, reconcileCurrentState, reconcileRemoteState, install });

  install();
  document.addEventListener("DOMContentLoaded", install, { once: true });
})();