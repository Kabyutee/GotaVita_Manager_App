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

// This module is loaded before script.js. The application state binding is
// created by script.js, so calling ensureGroupLegacyIds() at module-evaluation
// time throws ReferenceError: state is not defined. Run it only after the app
// lifecycle has finished initializing the state binding.
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