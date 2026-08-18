// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.

function openContainerControl(){
  switchTab("clients");
  requestAnimationFrame(() => {
    activateClientSubtab("containers");
    const panel = $("client-sub-containers");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}


function renderContainerControl(){
  const metrics = containerMetrics();
  const delivered = Number(metrics.delivered) || 0;
  const returned = Number(metrics.returned) || 0;
  const outstanding = Math.max(delivered - returned, 0);
  const rows = state.clients.map(c => ({ c, s: clientStats(c.name) }))
    .filter(x => x.s.outstandingContainers > 0)
    .sort((a,b) => (b.s.outstandingContainers || 0) - (a.s.outstandingContainers || 0));
  if ($("containerControlDelivered")) $("containerControlDelivered").textContent = delivered.toLocaleString();
  if ($("containerControlReturned")) $("containerControlReturned").textContent = returned.toLocaleString();
  if ($("containerControlOutstanding")) $("containerControlOutstanding").textContent = outstanding.toLocaleString();
  if ($("containerControlClients")) $("containerControlClients").textContent = rows.length.toLocaleString();
  const host = $("containerControlHighlights");
  if (!host) return;
  if (!rows.length) { host.innerHTML = '<div class="empty">All client containers are currently accounted for. 🎉</div>'; return; }
  host.innerHTML = rows.slice(0, 5).map(({c,s}) => {
    const level = s.outstandingContainers >= 10 ? "bad" : s.outstandingContainers >= 5 ? "warn-t" : "ok";
    return `<div class="container-highlight-row"><div><b>${esc(c.name)}</b><small>${esc(c.address||"No address")}</small></div><div class="container-highlight-right"><b class="${level}">${s.outstandingContainers}</b><button class="btn ghost tiny" data-action="openClientMiniPopup" data-action-args='[${jsAttrArg(c.name)}]'>View</button></div></div>`;
  }).join('');
}

function getContainerLedger(clientId) {
  const id = toId(clientId);
  return state.orders.filter(o => o.status !== "Cancelled").filter(o => {
    if (o.clientId) return toId(o.clientId) === id;
    const c = getClientById(id);
    return !!c && o.clientName === c.name;
  }).map(o => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    date: o.date,
    delivered: Math.max(Number(o.gallons) || 0, 0),
    returned: Math.min(Math.max(Number(o.emptyGallonsCollected) || 0, 0), Math.max(Number(o.gallons) || 0, 0)),
    balance: containerBalanceForOrder(o),
    status: o.status
  }));
}

function getOutstandingContainers(client) {
  return calculateClientStats(client).outstandingContainers;
}

function getCompanyContainerLedger() {
  return state.clients.map(c => {
    const stats = calculateClientStats(c);
    return {
      clientId: c.id,
      clientName: c.name,
      address: c.address || "",
      delivered: stats.gallons,
      returned: stats.emptyCollected,
      outstanding: stats.outstandingContainers
    };
  }).filter(x => x.delivered || x.returned || x.outstanding);
}

function containerBalanceForOrder(o) {
  const delivered = Math.max(Number(o.gallons) || 0, 0);
  const returned = Math.min(Math.max(Number(o.emptyGallonsCollected) || 0, 0), delivered);
  return Math.max(delivered - returned, 0);
}
