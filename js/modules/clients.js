// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.

function handleClientSubmit(e) {
  e.preventDefault();
  const name = $("clientName").value.trim();
  const address = $("clientAddress").value.trim();
  const validation = validateClientInput({ name, defaultPrice: $("clientDefaultPrice").value, phone: $("clientPhone").value, address });
  if (!validation.ok) { validationError(validation.message); return; }
  const editId = $("editClientId").value;
  const payload = {
    name: validation.value.name,
    group: $("clientGroup").value,
    phone: validation.value.phone,
    address: validation.value.address,
    defaultPrice: validation.value.defaultPrice,
    active: true,
    updatedAt: new Date().toISOString()
  };

  const duplicate = state.clients.find(c =>
    c.id != editId && String(c.name || '').trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    showToast("A client with that name already exists.", "error");
    return;
  }

  saveStateForUndo();
  if (editId) {
    const client = state.clients.find(c => String(c.id) === String(editId));
    if (!client) { showToast("Client record not found.", "error"); return; }
    const before = clone(client);
    Object.assign(client, payload);
    audit("update", "client", client.id, { before, after: clone(client) });
    showToast(`${name} updated.`);
  } else {
    const client = Object.assign({ id: Date.now(), createdAt: new Date().toISOString() }, payload);
    state.clients.push(client);
    audit("create", "client", client.id, { name: client.name });
    showToast(`${name} added.`);
  }
  persistState();
  resetClientForm();
  renderAll();
}


function editClient(id) {
  const client = state.clients.find(c => String(c.id) === String(id));
  if (!client) { showToast("Client record not found.", "error"); return; }
  $("editClientId").value = client.id;
  $("clientName").value = client.name || "";
  $("clientGroup").value = client.group || "General";
  $("clientPhone").value = client.phone || "";
  $("clientAddress").value = client.address || "";
  $("clientDefaultPrice").value = Number(client.defaultPrice) || 0;
  $("clientFormTitle").textContent = `✏️ Edit Client: ${client.name}`;
  $("saveClientBtn").textContent = "Update Client";
  $("cancelClientEditBtn").style.display = "inline-flex";
  switchTab("clients");
  activateClientSubtab("directory");
  $("clientName").focus();
}


function resetClientForm() {
  const form = $("clientForm");
  if (form) form.reset();
  $("editClientId").value = "";
  $("clientGroup").value = "Residential";
  $("clientDefaultPrice").value = "25";
  $("clientFormTitle").textContent = "👤 Add / Edit Client";
  $("saveClientBtn").textContent = "Save Client";
  $("cancelClientEditBtn").style.display = "none";
}


function clientSortValueToConfig(value) {
  const raw = String(value || "name-asc");
  const parts = raw.split("-");
  return { column: parts[0] || "name", asc: (parts[1] || "asc") !== "desc" };
}


function syncClientSortSelect() {
  const el = $("clientSort");
  if (!el) return;
  const value = `${sortConfig.clients.column}-${sortConfig.clients.asc ? "asc" : "desc"}`;
  if ([...el.options].some(o => o.value === value)) el.value = value;
}


function applyClientSortFromSelect(value) {
  sortConfig.clients = clientSortValueToConfig(value);
  renderClientDirectory();
}


function sortClients(col) {
  const c = sortConfig.clients;
  c.asc = c.column === col ? !c.asc : true;
  c.column = col;
  syncClientSortSelect();
  renderClientDirectory();
}


function clientStats(name) {
  const c = state.clients.find(x => x.name === name) || { id: "", name };
  return calculateClientStats(c);
}


function renderClientDirectory() {
  const tb=$("clientTableBody"); if(!tb) return;
  const q=($('clientSearchInput')?.value||'').toLowerCase(); const gf=$('clientGroupFilter')?.value||'';
  let rows=state.clients.filter(c => c.active !== false).slice(); if(q) rows=rows.filter(c=>normalizeSearchText([c.name, c.address, c.phone, c.group]).includes(q)); if(gf) rows=rows.filter(c=>c.group===gf);
  rows=rows.map(c=>({c,s:clientStats(c.name)}));
  const key=sortConfig.clients.column || 'name'; const dir=sortConfig.clients.asc ? 1 : -1;
  rows.sort((a,b)=>{let x=key==='gallons'?a.s.gallons:key==='empty'?a.s.emptyCollected:key==='outstanding'?a.s.outstandingContainers:key==='revenue'?a.s.revenue:key==='due'?a.s.due:(key==='group'?String(a.c.group||'').toLowerCase():String(a.c.name||'').toLowerCase()); let y=key==='gallons'?b.s.gallons:key==='empty'?b.s.emptyCollected:key==='outstanding'?b.s.outstandingContainers:key==='revenue'?b.s.revenue:key==='due'?b.s.due:(key==='group'?String(b.c.group||'').toLowerCase():String(b.c.name||'').toLowerCase()); return x<y?-1*dir:x>y?1*dir:0;});
  syncClientSortSelect();
  if($("clientCountLabel")) $("clientCountLabel").textContent=`(${rows.length} of ${state.clients.filter(c=>c.active !== false).length})`;
  if(!rows.length){tb.innerHTML='<tr><td colspan="9" class="empty">No clients found.</td></tr>'; return;}
  renderLazyList("clientTableBody", rows, ({c,s}) => `<tr><td><b style="cursor:pointer;color:var(--primary)" data-action="openClientMiniPopup" data-action-args='[${jsAttrArg(c.name)}]'>${esc(c.name)}</b><br><small>${esc(c.phone||'')}</small></td><td><span class="badge soft">${esc(c.group)}</span></td><td><small>${esc(c.address||'')}</small></td><td><b>${s.gallons}</b></td><td><b>${s.emptyCollected}</b></td><td><b class="${s.outstandingContainers>=10?'bad':s.outstandingContainers>=5?'warn-t':'ok'}">${s.outstandingContainers}</b></td><td><b>${peso(s.revenue)}</b></td><td><b class="${s.due>0?'bad':'ok'}">${peso(s.due)}</b></td><td><div class="row-btns"><button class="btn ghost tiny" data-action="openClientMiniPopup" data-action-args='[${jsAttrArg(c.name)}]'>View</button><button class="btn ghost tiny" data-action="editClient" data-action-args='[${jsAttrArg(c.id)}]'>Edit</button><button class="btn danger tiny" data-action="deleteClient" data-action-args='[${jsAttrArg(c.id)}]'>Archive</button></div></td></tr>`, '<tr><td colspan="9" class="empty">No clients found.</td></tr>', { colspan: 9 });
}


function getClientOrders(client, { limit = null } = {}) {
  if (!client) return [];
  const cid = toId(client.id);
  const rows = state.orders.filter(o =>
    (o.clientId && cid && toId(o.clientId) === cid) ||
    (!o.clientId && o.clientName === client.name)
  ).slice().sort((a,b)=>new Date(b.date || b.createdAt || 0)-new Date(a.date || a.createdAt || 0));
  return limit ? rows.slice(0, limit) : rows;
}


function openClientNewOrder(id) {
  const client = getClientById(id);
  if (!client) { showToast("Client record not found.", "error"); return; }
  closeModal("clientModal");
  switchTab("neworder");
  requestAnimationFrame(() => {
    const select = $("clientSelect");
    if (!select) return;
    select.value = client.name;
    autofillClientPrice();
    $("gallons")?.focus();
  });
}


function openClientEdit(id) {
  closeModal("clientModal");
  editClient(id);
}


function openClientOrders(id) {
  const client = getClientById(id);
  if (!client) { showToast("Client record not found.", "error"); return; }
  closeModal("clientModal");
  // All Orders is a subpanel inside Order Log, not a top-level tab.
  switchTab("orderlog");
  requestAnimationFrame(() => {
    const btn = document.querySelector('#orderSubtabs .subtab[data-sub="all"]');
    activateOrderSubtab("all", btn);
    const input = $("allOrdersSearchInput");
    if (input) {
      input.value = client.name;
      renderAllOrders();
      input.focus();
      input.select();
    }
  });
}


function openClientMiniPopup(nameOrId){
  const c = getClientById(nameOrId) || state.clients.find(x => x.name === nameOrId);
  if (!c) { showToast("Client record not found.", "error"); return; }
  const s = calculateClientStats(c);
  const recent = getClientOrders(c, { limit: 10 });
  const heldClass = s.outstandingContainers >= 10 ? "bad" : s.outstandingContainers >= 5 ? "warn-t" : "ok";
  const dueClass = s.due > 0 ? "bad" : "ok";
  $("clientModalContent").innerHTML = `
    <div class="client-profile-head">
      <div class="client-profile-identity">
        <div class="client-profile-avatar">${esc(String(c.name || "?").trim().charAt(0).toUpperCase())}</div>
        <div>
          <h3 style="margin:0">${esc(c.name)}</h3>
          <div class="emp-meta">${esc(c.group||"General")} · ${esc(c.address||"No address")}${c.phone ? ` · ${esc(c.phone)}` : ""}</div>
        </div>
      </div>
      <div class="client-profile-actions">
        <button class="btn primary tiny" data-action="openClientNewOrder" data-action-args='[${jsAttrArg(c.id)}]'>＋ New Order</button>
        <button class="btn ghost tiny" data-action="openClientOrders" data-action-args='[${jsAttrArg(c.id)}]'>View Orders</button>
        <button class="btn ghost tiny" data-action="openClientEdit" data-action-args='[${jsAttrArg(c.id)}]'>Edit Client</button>
      </div>
    </div>
    <div class="client-profile-stats">
      <div class="mini-card"><span class="mini-label">Lifetime Orders</span><b>${s.orders}</b></div>
      <div class="mini-card"><span class="mini-label">Gallons Sold</span><b>${s.gallons}</b></div>
      <div class="mini-card"><span class="mini-label">Empty Returned</span><b>${s.emptyCollected}</b></div>
      <div class="mini-card"><span class="mini-label">With Client</span><b class="${heldClass}">${s.outstandingContainers}</b></div>
      <div class="mini-card"><span class="mini-label">Lifetime Revenue</span><b class="ok">${peso(s.revenue)}</b></div>
      <div class="mini-card"><span class="mini-label">Open Balance</span><b class="${dueClass}">${peso(s.due)}</b></div>
    </div>
    <div class="client-profile-section-head"><h4>Recent Orders</h4><span class="emp-meta">Showing ${recent.length} of ${s.orders}</span></div>
    <div class="recent-list custom-scrollbar">
      ${recent.map(o=>`<div class="client-profile-order-row">
        <div><b>#${esc(o.orderNumber)}</b><span class="emp-meta"> · ${fmtDate(o.date)}</span><br><small>${Number(o.gallons)||0} containers · ${peso(o.total)}</small></div>
        <div class="client-profile-order-actions"><span class="badge ${String(o.status).toLowerCase()}">${esc(o.status)}</span><button class="btn ghost tiny" data-action="openOrderEditor" data-action-args='[${jsAttrArg(o.id)}]'>Edit</button></div>
      </div>`).join("") || '<div class="emp-meta">No orders yet.</div>'}
    </div>
  `;
  openModal("clientModal");
}

function renderLeaderboard() {
  const el = $("clientLeaderboard"); if (!el) return;
  const map = {};
  state.clients.forEach(c => { map[c.name] = { gallons: 0, revenue: 0, orders: 0, emptyCollected: 0 }; });
  state.orders.forEach((o) => {
    if (o.status === "Cancelled") return;
    if(!map[o.clientName]) map[o.clientName] = { gallons: 0, revenue: 0, orders: 0, emptyCollected: 0 };
    map[o.clientName].gallons += Number(o.gallons) || 0;
    map[o.clientName].revenue += Number(o.total) || 0;
    map[o.clientName].emptyCollected += Number(o.emptyGallonsCollected) || 0;
    map[o.clientName].orders++;
  });
  const rows = Object.entries(map).sort((a,b)=>b[1].gallons-a[1].gallons);
  if (!rows.length) { el.innerHTML = `<p class="empty">No clients found.</p>`; return; }
  const max = rows[0][1].gallons || 1; const medal=["🥇","🥈","🥉"];
  el.innerHTML = rows.map(([name,v],i)=>{ const held=Math.max(v.gallons-v.emptyCollected,0); return `<div class="lb-row animate__animated animate__fadeInUp" data-action="openClientMiniPopup" data-action-args='[${jsAttrArg(name)}]' style="cursor:pointer"><div class="lb-rank">${medal[i]||i+1}</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div><div class="emp-meta">${v.orders} orders · ${peso(v.revenue)} revenue · ${v.emptyCollected} empty returned</div><div class="lb-bar-bg"><div class="lb-bar-fill" style="width:${Math.max((v.gallons/max)*100,5)}%"></div></div></div><div style="text-align:right"><b>${v.gallons}</b><small class="emp-meta"> sold</small><br><b class="${held>=10?'bad':held>=5?'warn-t':'ok'}">${held}</b><small class="emp-meta"> held</small></div></div>`; }).join("");
}


function renderUncollectedContainers(){
  const tb=$("uncollectedContainerTableBody"); if(!tb) return;
  const rows=state.clients.map(c=>({c,s:clientStats(c.name)})).filter(x=>x.s.outstandingContainers>0);
  const mode=sortConfig.containers.column;
  const dir=sortConfig.containers.asc?1:-1;
  const valueFor=(row)=>mode==='name'?String(row.c.name||'').toLowerCase():Number(row.s[mode])||0;
  rows.sort((a,b)=>{
    const x=valueFor(a), y=valueFor(b);
    if(x===y) return 0;
    return x<y ? -1*dir : 1*dir;
  });
  if(!rows.length){tb.innerHTML='<tr><td colspan="6" class="empty">All client containers are currently accounted for. 🎉</td></tr>'; return;}
  renderLazyList("uncollectedContainerTableBody", rows, ({c,s})=>{const level=s.outstandingContainers>=10?'bad':s.outstandingContainers>=5?'warn-t':'ok'; const text=s.outstandingContainers>=10?'High — review this client':s.outstandingContainers>=5?'Watch — many containers outstanding':'Normal'; return `<tr><td><b>${esc(c.name)}</b><br><small>${esc(c.address||'')}</small></td><td>${s.gallons}</td><td>${s.emptyCollected}</td><td><b class="${level}">${s.outstandingContainers}</b></td><td><span class="badge soft">${text}</span></td><td><button class="btn ghost tiny" data-action="openClientMiniPopup" data-action-args='[${jsAttrArg(c.name)}]'>View Profile</button></td></tr>`;}, '<tr><td colspan="6" class="empty">All client containers are currently accounted for. 🎉</td></tr>', { colspan: 6 });
}


function setContainerSort(value) {
  const map = {
    outstanding: { column: 'outstanding', asc: false },
    outstandingAsc: { column: 'outstanding', asc: true },
    gallons: { column: 'gallons', asc: false },
    emptyCollected: { column: 'emptyCollected', asc: false },
    name: { column: 'name', asc: true }
  };
  const next = map[String(value)] || map.outstanding;
  sortConfig.containers = { ...next };
  const select = document.querySelector('#client-sub-containers select[data-action="sortContainerClients"]');
  if (select) select.value = String(value);
  renderUncollectedContainers();
}


function sortContainerClients(col){
  const c=sortConfig.containers;
  const normalized=col==='outstandingAsc'?'outstanding':col;
  if(col==='outstandingAsc'){ c.column='outstanding'; c.asc=true; }
  else { c.asc=c.column===normalized ? !c.asc : true; c.column=normalized; }
  const select = document.querySelector('#client-sub-containers select[data-action="sortContainerClients"]');
  if(select){
    const value = c.column==='outstanding' ? (c.asc ? 'outstandingAsc' : 'outstanding') : `${c.column}-${c.asc ? 'asc' : 'desc'}`;
    if([...select.options].some(o=>o.value===value)) select.value=value;
  }
  renderUncollectedContainers();
}
