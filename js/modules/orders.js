// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.

function renderProductDropdowns() {
  const s = $("custTypeSelect"); if (!s) return;
  const cur = s.value; s.innerHTML = "";
  state.products.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.name; o.textContent = `${p.name} (₱${p.price})`;
    s.appendChild(o);
  });
  if (cur) s.value = cur;
}


function renderClientDropdowns() {
  const s = $("clientSelect"); if (!s) return;
  const cur = s.value;
  s.innerHTML = '<option value="">-- Select Client --</option>';
  state.clients.filter(c => c.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => {
    const o = document.createElement("option");
    o.value = c.name; o.textContent = `${c.name} (${c.address || "No address"})`;
    s.appendChild(o);
  });
  if (cur) s.value = cur;
}


function renderEmployeeDropdowns() {
  const s = $("expenseEmployeeId"); if (!s) return;
  const cur = s.value; s.innerHTML = "";
  state.employees.forEach((e) => {
    const o = document.createElement("option");
    o.value = e.id; o.textContent = `${e.name} (${e.position})`;
    s.appendChild(o);
  });
  if (cur) s.value = cur;
  const pf = $("empPositionFilter");
  if (pf) {
    const curp = pf.value;
    const positions = Array.from(new Set(state.employees.map((e) => e.position))).sort();
    pf.innerHTML = '<option value="">All Positions</option>' + positions.map((p) => `<option>${esc(p)}</option>`).join("");
    pf.value = curp;
  }
}


function renderOrderEditorDropdowns() {
  const cs = $("editOrderClient"), ps = $("editOrderProduct");
  if (cs) { const cur = cs.value; cs.innerHTML = '<option value="">-- Select Client --</option>' + state.clients.filter(c => c.active !== false).slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join(""); if (cur) cs.value = cur; }
  if (ps) { const cur = ps.value; ps.innerHTML = state.products.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join(""); if (cur) ps.value = cur; }
}


function updateEditOrderTotal() {
  const g = parseFloat($("editOrderGallons")?.value) || 0;
  const p = parseFloat($("editOrderPrice")?.value) || 0;
  if ($("editOrderTotal")) $("editOrderTotal").textContent = peso(g * p);
}


function openOrderEditor(id) {
  const o = state.orders.find(x => idsEqual(x.id, id)); if (!o) return;
  renderOrderEditorDropdowns();
  $("editOrderId").value = o.id;
  $("editOrderClient").value = o.clientName || "";
  $("editOrderProduct").value = o.custType || "";
  $("editOrderGallons").value = o.gallons ?? 0;
  $("editOrderPrice").value = o.price ?? 0;
  $("editOrderStatus").value = o.status || "Unpaid";
  $("editOrderEmpty").value = o.emptyGallonsCollected ?? 0;
  $("editOrderAddress").value = o.address || "";
  $("editOrderNotes").value = o.notes || "";
  $("orderEditTitle").textContent = `✏️ Edit Order #${o.orderNumber || ""}`;
  updateEditOrderTotal();
  openModal("orderEditModal");
}


function handleOrderEditSubmit(e) {
  e.preventDefault();
  const id = $("editOrderId").value;
  const o = state.orders.find(x => idsEqual(x.id, id));
  if (!o) return;

  const clientName = $("editOrderClient").value;
  const productName = $("editOrderProduct").value;
  const editedClient = state.clients.find(c => c.name === clientName);
  const editedProduct = state.products.find(p => p.name === productName);
  const validation = validateOrderInput({
    clientName,
    clientId: editedClient?.id,
    custType: productName,
    productId: editedProduct?.id,
    gallons: $("editOrderGallons").value,
    price: $("editOrderPrice").value,
    status: $("editOrderStatus").value,
    emptyGallonsCollected: $("editOrderEmpty").value
  });
  if (!validation.ok) { validationError(validation.message); return; }

  const before = clone(o);
  saveStateForUndo();
  o.clientName = validation.value.clientName;
  o.custType = validation.value.custType;
  o.clientId = editedClient.id;
  o.productId = editedProduct.id;
  o.gallons = validation.value.gallons;
  o.price = validation.value.price;
  o.emptyGallonsCollected = validation.value.emptyGallonsCollected;
  recalculateOrderFinancials(o);
  applyOrderStatus(o, $("editOrderStatus").value);
  o.address = $("editOrderAddress").value.trim();
  o.notes = $("editOrderNotes").value.trim();
  o.updatedAt = new Date().toISOString();
  audit("update", "order", o.id, { before, after: clone(o) });
  persistState();
  renderAll();
  closeModal("orderEditModal");
  showToast(`Order #${o.orderNumber} updated.`);
}



function recalculateOrderFinancials(o) {
  if (!o) return;
  o.gallons = Math.max(Number(o.gallons) || 0, 0);
  o.price = Math.max(Number(o.price) || 0, 0);
  o.emptyGallonsCollected = Math.min(Math.max(Number(o.emptyGallonsCollected) || 0, 0), o.gallons);
  o.total = o.gallons * o.price;
  o.containerBalance = Math.max(o.gallons - o.emptyGallonsCollected, 0);
}


function applyOrderStatus(o, status) {
  if (!o || !['Paid','Unpaid','Pending','Cancelled'].includes(status)) return false;
  o.status = status;
  o.deliveryStatus = status === 'Paid' ? 'Delivered' : (status === 'Unpaid' ? 'Out for Delivery' : status);
  o.updatedAt = new Date().toISOString();
  return true;
}


function archiveOrders(orderIds, reason = 'manual') {
  const ids = (orderIds || []).map(String);
  const targets = state.orders.filter(o => ids.includes(String(o.id)));
  if (!targets.length) return 0;
  makeAutoBackup(false);
  targets.forEach(o => {
    state.deletedOrders.push(o);
    audit('archive', 'order', o.id, { orderNumber: o.orderNumber, reason });
  });
  state.orders = state.orders.filter(o => !ids.includes(String(o.id)));
  state.orderGroups.forEach(g => {
    g.orderIds = (g.orderIds || []).filter(x => !ids.includes(String(x)));
  });
  return targets.length;
}

function handleProductSelectionChange() {
  const t = $("custTypeSelect"), p = $("price"), cs = $("clientSelect");
  const prod = state.products.find((x) => x.name === t.value);
  if (prod) {
    let price = prod.price;
    if (prod.category === "Refill" && cs.value) {
      const c = state.clients.find((x) => x.name === cs.value);
      if (c && c.defaultPrice) price = c.defaultPrice;
    }
    p.value = price;
  }
  calculateOrderTotalPreview();
}


function autofillClientPrice() {
  const cs = $("clientSelect"), addr = $("orderAddress"), t = $("custTypeSelect"), p = $("price");
  const c = state.clients.find((x) => x.name === cs.value);
  if (c) {
    if (c.address) addr.value = c.address;
    const prod = state.products.find((x) => x.name === t.value);
    if (prod && prod.category === "Refill" && c.defaultPrice) p.value = c.defaultPrice;
  }
  calculateOrderTotalPreview();
}


function calculateOrderTotalPreview() {
  const g = parseFloat($("gallons").value) || 0;
  const p = parseFloat($("price").value) || 0;
  const disp = $("orderTotalDisplay");
  if (disp) disp.textContent = peso(g * p);
}


function clearNewOrderForm({ preserveClient = false } = {}) {
  const client = $("clientSelect");
  const product = $("custTypeSelect");
  const currentClient = preserveClient ? client?.value : "";
  if (client) client.value = currentClient;
  if (product && !product.value && product.options.length) product.selectedIndex = 0;
  if (!preserveClient) {
    if (client) client.value = "";
    if ($("orderAddress")) $("orderAddress").value = "";
  }
  if ($("gallons")) $("gallons").value = "1";
  if ($("paymentStatus")) $("paymentStatus").value = "Unpaid";
  if ($("emptyGallonsCollected")) $("emptyGallonsCollected").value = "0";
  if ($("orderNotes")) $("orderNotes").value = "";
  if (preserveClient) autofillClientPrice();
  else handleProductSelectionChange();
  requestAnimationFrame(() => $(preserveClient ? "gallons" : "clientSelect")?.focus());
}


function repeatLastOrder() {
  const last = state.orders.slice().sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))[0];
  if (!last) { showToast("There is no previous order to repeat.", "error"); return; }
  const client = state.clients.find(c => (last.clientId && idsEqual(c.id, last.clientId)) || c.name === last.clientName);
  const product = state.products.find(p => (last.productId && idsEqual(p.id, last.productId)) || p.name === last.custType);
  if (!client || !product) {
    showToast("The previous order references a client or product that no longer exists.", "error");
    return;
  }
  $("clientSelect").value = client.name;
  $("custTypeSelect").value = product.name;
  $("gallons").value = last.gallons ?? 1;
  $("price").value = last.price ?? product.price ?? 0;
  $("orderAddress").value = last.address || client.address || "";
  $("paymentStatus").value = "Unpaid";
  $("emptyGallonsCollected").value = "0";
  $("orderNotes").value = "";
  calculateOrderTotalPreview();
  requestAnimationFrame(() => $("gallons")?.focus());
  showToast(`Loaded the previous order for ${client.name}. Review and save when ready.`);
}


function handleOrderSubmit(e) {
  e.preventDefault();
  const clientName = $("clientSelect").value;
  const selectedClient = state.clients.find(c => c.name === clientName);
  const selectedProduct = state.products.find(p => p.name === $("custTypeSelect").value);
  const validation = validateOrderInput({
    clientName,
    clientId: selectedClient?.id,
    custType: $("custTypeSelect").value,
    productId: selectedProduct?.id,
    gallons: $("gallons").value,
    price: $("price").value,
    status: $("paymentStatus").value,
    emptyGallonsCollected: $("emptyGallonsCollected")?.value
  });
  if (!validation.ok) { validationError(validation.message); return; }
  saveStateForUndo();
  state.orderCounter++;
  const gallons = validation.value.gallons;
  const price = validation.value.price;
  const nowIso = new Date().toISOString();
  const emptyCollected = validation.value.emptyGallonsCollected;
  const order = {
    id: Date.now(),
    clientId: selectedClient?.id ?? null,
    productId: selectedProduct?.id ?? null,
    orderNumber: String(state.orderCounter).padStart(7, "0"),
    custType: $("custTypeSelect").value,
    clientName, address: $("orderAddress").value,
    gallons, price,
    status: $("paymentStatus").value,
    emptyGallonsCollected: emptyCollected,
    notes: $("orderNotes").value,
    date: nowIso, createdAt: nowIso, updatedAt: nowIso
  };
  recalculateOrderFinancials(order);
  applyOrderStatus(order, order.status);
  state.orders.push(order);
  audit("create", "order", order.id, { orderNumber: order.orderNumber, total: order.total, clientName: order.clientName });
  persistState(); renderPartial("orders");
  $("gallons").value = "1";
  $("paymentStatus").value = "Unpaid";
  $("orderNotes").value = "";
  if ($("emptyGallonsCollected")) $("emptyGallonsCollected").value = "0";
  calculateOrderTotalPreview();
  requestAnimationFrame(() => $("gallons")?.focus());
  showToast(`Order #${String(state.orderCounter).padStart(7, "0")} recorded!`);
}


function renderAllOrderViews() {
  renderOrderLog();
  renderCompletedTransactions();
  renderAllOrders();
  renderUnpaidReceivables();
}


function orderRowsWithinDate(rows) {
  const filter = $("orderDateFilter")?.value || "all";
  return rows.filter(o => matchesDateFilter(o.date, filter, $("orderDateFrom")?.value || "", $("orderDateTo")?.value || ""));
}


function sortOrders(col) {
  const c = sortConfig.orders;
  c.asc = c.column === col ? !c.asc : true;
  c.column = col;
  renderOrderLog();
  renderCompletedTransactions();
  renderAllOrders();
  renderUnpaidReceivables();
}


function renderOrderLog() {
  const tb = $("orderTableBody"); if (!tb) return;
  const q = normalizeSearchText($("orderSearchInput").value || "");
  let rows = state.orders.filter((o) => o.status === "Unpaid" || o.status === "Pending");
  rows = orderRowsWithinDate(rows);
  if (q) rows = rows.filter((o) => normalizeSearchText([o.orderNumber, o.clientName, o.address, o.notes, o.custType]).includes(q));
  rows = sortRows(rows, sortConfig.orders);
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="10" class="empty">No active pending or unpaid orders.</td></tr>`; return; }
  tb.innerHTML = rows.map((o) => {
    const g = groupOf(o.id);
    return `<tr class="${tableRenderClass(rows.length)}">
      <td><input type="checkbox" class="order-checkbox" value="${o.id}"></td>
      <td><b>${esc(o.orderNumber)}</b></td>
      <td><small>${fmtDate(o.date)}</small></td>
      <td><b>${esc(o.clientName)}</b><br><small>${esc(o.address || "")}</small></td>
      <td><small>${esc(o.custType)}</small></td>
      <td><input type="number" value="${o.gallons}" style="width:68px" data-action="updateOrderInline" data-action-args='[${o.id},"gallons","__VALUE__"]'></td>
      <td><input type="number" value="${o.price}" style="width:72px" data-action="updateOrderInline" data-action-args='[${o.id},"price","__VALUE__"]'></td>
      <td><b>${peso(o.total)}</b></td>
      <td><button class="btn ghost tiny" data-action="openGroupPicker" data-action-args='[[${o.id}]]'>${g ? "📦 " + esc(g) : "＋ Assign Route"}</button></td>
      <td><div class="row-btns">
        <button class="btn ghost tiny" data-action="openOrderEditor" data-action-args='[${o.id}]'>✏️ Edit</button>
        <button class="btn ghost tiny" data-action="viewReceipt" data-action-args='[${o.id}]'>🧾</button>
        <button class="btn primary tiny" data-action="updateOrderStatus" data-action-args='[${o.id},"Paid"]'>Paid</button>
        <button class="btn danger tiny" data-action="deleteOrder" data-action-args='[${o.id}]'>Del</button>
      </div></td>
    </tr>`;
  }).join("");
}


function renderCompletedTransactions() {
  const tb = $("billingTableBody"); if (!tb) return;
  const q = normalizeSearchText($("billingSearchInput").value || "");
  let rows = state.orders.filter((o) => o.status === "Paid");
  rows = orderRowsWithinDate(rows);
  if (q) rows = rows.filter((o) => normalizeSearchText([o.orderNumber, o.clientName, o.custType]).includes(q));
  rows = sortRows(rows, sortConfig.orders);
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="10" class="empty">No completed transactions yet.</td></tr>`; return; }
  tb.innerHTML = rows.map((o) => {
    const g = groupOf(o.id);
    return `<tr class="${tableRenderClass(rows.length)}">
      <td><input type="checkbox" class="billing-checkbox" value="${o.id}"></td>
      <td><b>${esc(o.orderNumber)}</b></td><td><small>${fmtDate(o.date)}</small></td>
      <td><b>${esc(o.clientName)}</b><br><small>${esc(o.address || "No address")}</small></td><td><small>${esc(o.custType)}</small></td>
      <td>${o.gallons}</td><td>${peso(o.price)}</td><td><b class="ok">${peso(o.total)}</b></td><td><small>${esc(g || "-")}</small></td>
      <td><div class="row-btns">
        <button class="btn ghost tiny" data-action="openOrderEditor" data-action-args='[${o.id}]'>✏️ Edit</button>
        <button class="btn ghost tiny" data-action="viewReceipt" data-action-args='[${o.id}]'>🧾 Receipt</button>
        <button class="btn ghost tiny" data-action="openGroupPicker" data-action-args='[[${o.id}]]'>📦 Group</button>
        <button class="btn ghost tiny" data-action="revertOrderToUnpaid" data-action-args='[${o.id}]'>↩ Unpaid</button>
      </div></td>
    </tr>`;
  }).join("");
}


function renderAllOrders() {
  const tb = $("allOrdersTableBody"); if (!tb) return;
  const q = normalizeSearchText($("allOrdersSearchInput").value || "");
  let rows = orderRowsWithinDate(state.orders.slice());
  if (q) rows = rows.filter((o) => normalizeSearchText([o.orderNumber, o.clientName, o.address, o.notes, o.custType, o.status]).includes(q));
  rows = sortRows(rows, sortConfig.orders);
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="10" class="empty">No orders recorded.</td></tr>`; return; }
  tb.innerHTML = rows.map((o) => {
    const g = groupOf(o.id);
    return `<tr class="${tableRenderClass(rows.length)}">
      <td><input type="checkbox" class="all-order-checkbox" value="${o.id}"></td>
      <td><b>${esc(o.orderNumber)}</b></td><td><small>${fmtDate(o.date)}</small></td>
      <td><b>${esc(o.clientName)}</b><br><small>${esc(o.address || "No address")}</small></td><td><small>${esc(o.custType)}</small></td>
      <td>${o.gallons}</td><td>${peso(o.price)}</td><td><b>${peso(o.total)}</b></td><td><small>${esc(g || "-")}</small></td>
      <td><div class="row-btns">
        <button class="btn ghost tiny" data-action="openOrderEditor" data-action-args='[${o.id}]'>✏️ Edit</button>
        <button class="btn ghost tiny" data-action="viewReceipt" data-action-args='[${o.id}]'>🧾</button>
        <button class="btn ghost tiny" data-action="openGroupPicker" data-action-args='[[${o.id}]]'>📦 Group</button>
        <button class="btn ghost tiny" data-action="updateOrderStatus" data-action-args='[${o.id},${jsAttrArg(o.status === "Paid" ? "Unpaid" : "Paid")}]'>${o.status === "Paid" ? "↩ Unpaid" : "✓ Paid"}</button>
      </div></td>
    </tr>`;
  }).join("");
}


function updateOrderInline(id, field, val) {
  const o = state.orders.find((x) => idsEqual(x.id, id)); if (!o) return;
  saveStateForUndo();
  const before = clone(o);
  if (["gallons","price","emptyGallonsCollected"].includes(field)) o[field] = Math.max(parseFloat(val) || 0, 0);
  else o[field] = val;
  recalculateOrderFinancials(o);
  o.updatedAt = new Date().toISOString();
  audit("update", "order", o.id, { before, after: clone(o) });
  persistState(); renderPartial("orders"); showToast("Order updated.");
}


function updateOrderStatus(id, status) {
  const o = state.orders.find((x) => idsEqual(x.id, id)); if (!o) return;
  if (!['Paid','Unpaid','Pending','Cancelled'].includes(status)) return;
  saveStateForUndo();
  const before = clone(o);
  o.status = status;
  o.deliveryStatus = status === 'Paid' ? 'Delivered' : (status === 'Unpaid' ? 'Out for Delivery' : status);
  o.updatedAt = new Date().toISOString();
  audit('update', 'order', o.id, { before, after: clone(o) });
  persistState(); renderAll();
  if (status === 'Paid') confetti();
  showToast(`Order #${o.orderNumber} marked ${status}.`);
}


function revertOrderToUnpaid(id) {
  saveStateForUndo();
  const o = state.orders.find((x) => x.id === id); if (o) o.status = "Unpaid";
  persistState(); renderPartial("orders"); showToast("Reverted to unpaid.");
}
