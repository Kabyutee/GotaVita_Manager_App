// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.

function idsEqual(a, b) { return String(a) === String(b); }

function newGroupLegacyId() {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureGroupLegacyIds() {
  if (!Array.isArray(state.orderGroups)) return;
  state.orderGroups.forEach((group) => {
    if (!group || group.id != null && String(group.id).trim() !== "") return;
    group.id = newGroupLegacyId();
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("gv-app-ready", ensureGroupLegacyIds, { once: true });
}

function groupOf(orderId) {
  const g = state.orderGroups.find((g) => (g.orderIds || []).some((x) => idsEqual(x, orderId)));
  return g ? g.name : "";
}

function createGroup() {
  const name = $("newGroupName").value.trim();
  if (!name) { showToast("Enter a group name.", "error"); return; }
  if (state.orderGroups.some((g) => g.name.toLowerCase() === name.toLowerCase())) { showToast("Group already exists.", "error"); return; }
  saveStateForUndo();
  state.orderGroups.push({ id: newGroupLegacyId(), name, orderIds: [] });
  $("newGroupName").value = "";
  persistState(); renderAll(); showToast(`Group "${name}" created.`);
}

function editGroup(index) {
  const g = state.orderGroups[index];
  if (!g) return;
  if (!g.id) g.id = newGroupLegacyId();
  const newName = prompt("Edit Route / Group Name:", g.name);
  if (newName && newName.trim() !== "" && newName.trim().toLowerCase() !== g.name.toLowerCase()) {
    if (state.orderGroups.some((grp, i) => i !== index && grp.name.toLowerCase() === newName.trim().toLowerCase())) {
      showToast("Group name already in use.", "error"); return;
    }
    saveStateForUndo();
    g.name = newName.trim();
    persistState(); renderPartial("groups"); showToast("Group updated.");
  }
}

function renderOrderGroups() {
  const el = $("groupList"); if (!el) return;
  const mode = $("groupSort")?.value || 'name-asc';
  let groups = state.orderGroups.map((g,i) => {
    const orders = (g.orderIds || []).map(id => state.orders.find(o => idsEqual(o.id,id))).filter(Boolean);
    return { g, i, orders, total: orders.reduce((s,o)=>s+(o.total||0),0), gallons: orders.reduce((s,o)=>s+(o.gallons||0),0) };
  });
  const cmp = (a,b) => mode==='orders-desc' ? b.orders.length-a.orders.length : mode==='containers-desc' ? b.gallons-a.gallons : mode==='total-desc' ? b.total-a.total : a.g.name.localeCompare(b.g.name);
  groups.sort(cmp);
  if (!groups.length) { el.innerHTML = `<p class="empty" style="grid-column:1/-1;">No delivery groups created yet.</p>`; return; }
  el.innerHTML = groups.map(({g,i,orders,total,gallons}) => `<div class="group-card animate__animated animate__zoomIn">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;"><div><h4>📦 ${esc(g.name)}</h4><div class="emp-meta">${orders.length} order(s) · ${gallons} containers · ${peso(total)}</div></div><button class="btn ghost tiny" data-action="editGroup" data-action-args='[${i}]'>Edit Name</button></div>
    <div class="group-orders custom-scrollbar" style="max-height:170px; overflow-y:auto; margin:12px 0">
      ${orders.length ? orders.map(o => `<div class="group-order"><span><b>${esc(o.clientName)}</b><br><small>${esc(o.address || "No address")}</small><br><small>${esc(o.orderNumber)} · ${o.gallons} containers · ${peso(o.total)} · ${o.status}</small></span><button class="btn danger tiny" data-action="removeOrderFromGroup" data-action-args='[${jsAttrArg(o.id)}]'>✕</button></div>`).join('') : '<div class="emp-meta" style="padding:10px 0;">No orders assigned.</div>'}
    </div>
    <div class="row-btns">
      <button class="btn primary tiny block" data-action="openGroupManager" data-action-args='[${i}]'>✏️ Manage Orders</button>
      <button class="btn ghost tiny block" data-action="copyGroupList" data-action-args='[${i}]'>📋 Copy List</button>
      <button class="btn ghost tiny block" data-action="markGroupPaid" data-action-args='[${i}]'>✅ Paid</button>
      <button class="btn danger tiny block" data-action="disbandGroup" data-action-args='[${i}]'>Disband</button>
    </div>
  </div>`).join('');
}

function openGroupManager(index) {
  const g = state.orderGroups[index]; if (!g) return;
  if (!g.id) g.id = newGroupLegacyId();
  $("groupManageIndex").value = index; $("groupManageTitle").textContent = `📦 Manage Orders · ${g.name}`; $("groupManageSearch").value=''; renderGroupManager(); openModal('groupManageModal');
}

function renderGroupManager() {
  const index = Number($("groupManageIndex")?.value); const g = state.orderGroups[index]; const body = $("groupManageBody"); if (!g || !body) return;
  const q = ($("groupManageSearch")?.value || '').toLowerCase();
  let orders = state.orders.filter(o => o.status !== "Cancelled").slice();
  if (q) orders = orders.filter(o => normalizeSearchText([o.orderNumber, o.clientName, o.custType, o.status]).includes(q));
  const current = new Set((g.orderIds||[]).map(String));
  $("groupManageCount").textContent = `${current.size} selected`;
  renderLazyList("groupManageBody", orders, (o) => `<label class="group-manage-row"><input type="checkbox" class="group-manage-check" value="${esc(o.id)}" ${current.has(String(o.id))?'checked':''}><span><b>${esc(o.clientName)}</b><small>${esc(o.address || "No address")}</small><small>#${esc(o.orderNumber)} · ${o.gallons} containers · ${peso(o.total)} · ${o.status}</small></span><span class="badge ${String(o.status).toLowerCase()}">${o.status}</span></label>`, '<p class="empty">No matching orders.</p>', { initial: 50, chunk: 50 });
}

function saveGroupManager() {
  const index = Number($("groupManageIndex").value); const g = state.orderGroups[index]; if (!g) return;
  if (!g.id) g.id = newGroupLegacyId();
  saveStateForUndo();
  const validOrderIds = new Set(state.orders.filter(o => o.status !== "Cancelled").map(o => String(o.id)));
  g.orderIds = Array.from(document.querySelectorAll('.group-manage-check:checked')).map(c => String(c.value)).filter(id => validOrderIds.has(id));
  persistState(); renderPartial("groups"); closeModal('groupManageModal'); showToast(`Group "${g.name}" updated.`);
}

function removeOrderFromGroup(orderId) {
  saveStateForUndo();
  let removed = 0;
  state.orderGroups.forEach((g) => { if (!g.id) g.id = newGroupLegacyId();
    const before = (g.orderIds || []).length;
    g.orderIds = (g.orderIds || []).filter((x) => !idsEqual(x, orderId));
    removed += before - g.orderIds.length;
  });
  persistState(); renderPartial("groups");
  showToast(removed ? "Order removed from group." : "Order was not assigned to a group.", removed ? "success" : "error");
}

function assignOrdersToGroup(orderIds, groupName) {
  saveStateForUndo();
  ensureGroupLegacyIds();
  state.orderGroups.forEach((g) => { g.orderIds = (g.orderIds || []).filter((x) => !orderIds.some((id) => idsEqual(x, id))); });
  let g = state.orderGroups.find((g) => String(g.name).toLowerCase() === String(groupName).toLowerCase());
  if (!g) { g = { id: newGroupLegacyId(), name: groupName, orderIds: [] }; state.orderGroups.push(g); }
  const eligibleIds = orderIds.map(String).filter((id) => {
    const order = state.orders.find(o => idsEqual(o.id, id));
    return order && order.status !== "Cancelled";
  });
  eligibleIds.forEach((id) => { if (!(g.orderIds || []).some((x) => idsEqual(x, id))) g.orderIds.push(id); });
  persistState(); renderPartial("groups"); closeModal("groupPickerModal");
  showToast(eligibleIds.length ? `Assigned ${eligibleIds.length} order(s) to "${groupName}".` : "No eligible orders were assigned.", eligibleIds.length ? "success" : "error");
}

function openGroupPicker(orderIds) {
  groupPickerOrderIds = orderIds.map(String);
  const currentGroup = orderIds.length === 1 ? groupOf(orderIds[0]) : "";
  $("groupPickerTitle").textContent = orderIds.length === 1
    ? `Assign Order #${(state.orders.find((o) => o.id === orderIds[0]) || {}).orderNumber || ""} to Group`
    : `Assign ${orderIds.length} Orders to Group`;
  const body = $("groupPickerBody");
  let html = "";
  if (state.orderGroups.length) {
    html += state.orderGroups.map((g) => {
      const isCur = g.name === currentGroup;
      const args = [groupPickerOrderIds, g.name];
      return `<button class="gp-item-btn ${isCur ? "current" : ""}" type="button" data-action="assignOrdersToGroup" data-action-args='${jsAttrArg(args)}'>
        <span>📦 ${esc(g.name)}</span>
        <small class="emp-meta">${(g.orderIds || []).length} orders ${isCur ? "(current)" : ""}</small>
      </button>`;
    }).join("");
  } else {
    html += `<div class="emp-meta" style="padding:10px;">No groups exist yet. Create a new group below.</div>`;
  }
  if (currentGroup) {
    html += `<button class="gp-item-btn" type="button" style="border-color:var(--danger); color:var(--danger); margin-top:10px;" data-action="removeSelectedFromGroup">
      <span>🚫 Remove from Group</span>
    </button>`;
  }
  body.innerHTML = html;
  $("groupPickerNew").value = "";
  openModal("groupPickerModal");
}

function removeSelectedFromGroup() {
  saveStateForUndo();
  ensureGroupLegacyIds();
  state.orderGroups.forEach((g) => { g.orderIds = (g.orderIds || []).filter((x) => !groupPickerOrderIds.some((id) => idsEqual(x, id))); });
  persistState(); renderPartial("groups"); closeModal("groupPickerModal");
  showToast("Removed from group.");
}

function groupPickerCreate() {
  const name = $("groupPickerNew").value.trim();
  if (!name) { showToast("Enter a group name.", "error"); return; }
  assignOrdersToGroup(groupPickerOrderIds, name);
}

function markGroupPaid(i) {
  const g = state.orderGroups[i]; if (!g) return;
  if (!g.id) g.id = newGroupLegacyId();
  saveStateForUndo();
  let updated = 0;
  state.orders.forEach((o) => {
    if (o.status !== "Cancelled" && (g.orderIds || []).some((id) => idsEqual(id, o.id)) && applyOrderStatus(o, "Paid")) {
      updated++;
      audit("update", "order", o.id, { status: "Paid", source: "group", group: g.name });
    }
  });
  persistState(); renderAll(); confetti(); showToast(`${updated} order(s) in "${g.name}" marked as paid.`);
}

function copyGroupList(i) {
  const g = state.orderGroups[i]; if (!g) return;
  const orders = (g.orderIds||[]).map(id=>state.orders.find(o=>idsEqual(o.id,id))).filter(Boolean);
  const text = [`${g.name}`, ...orders.map(o=>`${o.clientName} - ${o.gallons} - ${peso(o.total)}`)].join('\n');
  navigator.clipboard ? navigator.clipboard.writeText(text).then(()=>showToast('Group list copied.')) : prompt('Copy:', text);
}

/* Sprint 14 — existing-order group editor integration.
 * Extends the existing Edit Order modal without touching the sync layer.
 */
(function installOrderEditGroupSelector() {
  const originalOpenOrderEditor = window.openOrderEditor;

  function ensureGroupSelect() {
    const form = $("orderEditForm");
    if (!form) return null;
    let select = $("editOrderGroup");
    if (select) return select;
    const fields = form.querySelector(".field-grid");
    if (!fields) return null;
    const label = document.createElement("label");
    label.className = "field wide";
    label.innerHTML = `<span>Delivery Group</span><select id="editOrderGroup"><option value="">-- No Group --</option></select>`;
    fields.appendChild(label);
    return $("editOrderGroup");
  }

  function renderGroupOptions(selected = "") {
    const select = ensureGroupSelect();
    if (!select) return;
    select.innerHTML = `<option value="">-- No Group --</option>` +
      state.orderGroups
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        .map((g) => `<option value="${esc(g.name)}">${esc(g.name)}</option>`)
        .join("");
    select.value = selected || "";
  }

  if (typeof originalOpenOrderEditor === "function") {
    window.openOrderEditor = function wrappedOpenOrderEditor(id) {
      originalOpenOrderEditor(id);
      const order = state.orders.find((x) => idsEqual(x.id, id));
      renderGroupOptions(order ? groupOf(order.id) : "");
    };
    openOrderEditor = window.openOrderEditor;
  }

  const originalHandleOrderEditSubmit = window.handleOrderEditSubmit;
  if (typeof originalHandleOrderEditSubmit !== "function") return;

  window.handleOrderEditSubmit = function wrappedHandleOrderEditSubmit(e) {
    e.preventDefault();
    const id = $("editOrderId").value;
    const o = state.orders.find(x => idsEqual(x.id, id));
    if (!o) return;
    const clientName = $("editOrderClient").value;
    const productName = $("editOrderProduct").value;
    const editedClient = state.clients.find(c => c.name === clientName);
    const editedProduct = state.products.find(p => p.name === productName);
    const validation = validateOrderInput({ clientName, clientId: editedClient?.id, custType: productName, productId: editedProduct?.id, gallons: $("editOrderGallons").value, price: $("editOrderPrice").value, status: $("editOrderStatus").value, emptyGallonsCollected: $("editOrderEmpty").value });
    if (!validation.ok) { validationError(validation.message); return; }
    const before = clone(o);
    const beforeGroup = groupOf(o.id);
    const selectedGroup = $("editOrderGroup")?.value?.trim() || "";
    if (selectedGroup && !state.orderGroups.some((g) => String(g.name).toLowerCase() === selectedGroup.toLowerCase())) { validationError("Selected delivery group no longer exists."); return; }
    saveStateForUndo();
    o.clientName = validation.value.clientName; o.custType = validation.value.custType; o.clientId = editedClient.id; o.productId = editedProduct.id; o.gallons = validation.value.gallons; o.price = validation.value.price; o.emptyGallonsCollected = validation.value.emptyGallonsCollected;
    recalculateOrderFinancials(o); applyOrderStatus(o, $("editOrderStatus").value); o.address = $("editOrderAddress").value.trim(); o.notes = $("editOrderNotes").value.trim(); o.updatedAt = new Date().toISOString();
    ensureGroupLegacyIds();
    state.orderGroups.forEach((g) => { g.orderIds = (g.orderIds || []).filter((orderId) => !idsEqual(orderId, o.id)); });
    if (selectedGroup) { const group = state.orderGroups.find((g) => String(g.name).toLowerCase() === selectedGroup.toLowerCase()); if (group) { group.orderIds = group.orderIds || []; if (!group.orderIds.some((orderId) => idsEqual(orderId, o.id))) group.orderIds.push(o.id); } }
    persistState(); renderAll(); closeModal("orderEditModal");
    audit("update", "order", o.id, { before, after: clone(o), source: "edit-order", groupBefore: beforeGroup, groupAfter: selectedGroup });
    if (typeof GVSync !== "undefined" && typeof GVSync.flush === "function") GVSync.flush().catch(() => {});
    showToast("Order updated.");
  };
  window.handleOrderEditSubmit = window.handleOrderEditSubmit;
})();