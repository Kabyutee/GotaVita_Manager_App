/* GotaVita Manager — Daily L300 Delivery Runs
 * Operating layer on top of existing Orders + Order Groups.
 * L300 order membership is sourced from the canonical Order Group.
 */
(function () {
  "use strict";

  const RUN_DEFS = [
    { id: "masagana-alabang", name: "MASAGANA", area: "ALABANG", timeWindow: "Morning", groupId: "l300_masagana-alabang" },
    { id: "atc-alabang", name: "ATC", area: "ALABANG", timeWindow: "After Lunch", groupId: "l300_atc-alabang" },
    { id: "festival-alabang", name: "FESTIVAL", area: "ALABANG", timeWindow: "Before Dinner", groupId: "l300_festival-alabang" }
  ];

  function escRun(value) {
    return typeof esc === "function" ? esc(value == null ? "" : String(value)) : String(value == null ? "" : value).replace(/[&<>\"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }
  function money(value) { return typeof peso === "function" ? peso(Number(value) || 0) : `₱${(Number(value) || 0).toFixed(2)}`; }
  function sameDate(a, b) { return typeof sameDay === "function" ? sameDay(a, b) : new Date(a).toDateString() === new Date(b).toDateString(); }
  function idEq(a, b) { return String(a) === String(b); }
  function activeOrder(o) { return o && o.status !== "Cancelled"; }

  function ensureDailyRunState() {
    if (!Array.isArray(state.dailyRuns)) state.dailyRuns = [];
    RUN_DEFS.forEach(def => {
      let run = state.dailyRuns.find(x => x.id === def.id);
      if (!run) {
        run = { id: def.id, name: def.name, area: def.area, timeWindow: def.timeWindow, groupId: def.groupId, status: "Ready", date: null, sequence: [], deliveredOrderIds: [], notes: "" };
        state.dailyRuns.push(run);
      }
      run.name = def.name;
      run.area = def.area;
      run.timeWindow = def.timeWindow;
      if (!run.groupId) run.groupId = def.groupId;
      if (!Array.isArray(run.sequence)) run.sequence = [];
      if (!Array.isArray(run.deliveredOrderIds)) run.deliveredOrderIds = [];
    });
  }

  function groupForRun(run) {
    const byId = state.orderGroups.find(g => g && idEq(g.id, run?.groupId));
    if (byId) return byId;
    const exact = state.orderGroups.find(g => String(g.name || "").trim().toLowerCase() === `${run.name} · ${run.area}`.toLowerCase());
    if (exact) {
      run.groupId = exact.id;
      return exact;
    }
    return state.orderGroups.find(g => String(g.name || "").trim().toLowerCase() === run.name.toLowerCase()) || null;
  }

  function runOrders(run) {
    const group = groupForRun(run);
    const ids = new Set(group ? (group.orderIds || []).map(String) : []);
    const today = new Date();
    const grouped = state.orders.filter(o => activeOrder(o) && ids.has(String(o.id)) && sameDate(o.date || today, today));
    let rows = Array.from(grouped);
    const sequence = new Map((run.sequence || []).map((id, i) => [String(id), i]));
    rows.sort((a, b) => {
      const ai = sequence.has(String(a.id)) ? sequence.get(String(a.id)) : 999999;
      const bi = sequence.has(String(b.id)) ? sequence.get(String(b.id)) : 999999;
      if (ai !== bi) return ai - bi;
      return String(a.clientName || "").localeCompare(String(b.clientName || ""));
    });
    return rows;
  }

  function metrics(rows, run) {
    const revenue = rows.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const paid = rows.filter(o => o.status === "Paid").reduce((s, o) => s + (Number(o.total) || 0), 0);
    const receivable = Math.max(revenue - paid, 0);
    const gallons = rows.reduce((s, o) => s + (Number(o.gallons) || 0), 0);
    const returned = rows.reduce((s, o) => s + Math.min(Math.max(Number(o.emptyGallonsCollected ?? o.emptyCollected ?? 0) || 0, 0), Math.max(Number(o.gallons) || 0, 0)), 0);
    const delivered = rows.filter(o => (run.deliveredOrderIds || []).some(id => idEq(id, o.id)) || o.deliveryStatus === "Delivered").length;
    return { orders: rows.length, gallons, revenue, paid, receivable, returned, delivered };
  }

  function initializeRunGroups() {
    ensureDailyRunState();
    let created = 0;
    RUN_DEFS.forEach(def => {
      let group = state.orderGroups.find(g => String(g.id) === String(def.groupId));
      if (!group) group = state.orderGroups.find(g => String(g.name || "").trim().toLowerCase() === `${def.name} · ${def.area}`.toLowerCase());
      if (!group) {
        group = { id: def.groupId, name: `${def.name} · ${def.area}`, orderIds: [] };
        state.orderGroups.push(group);
        created++;
      }
      if (!group.id) group.id = def.groupId;
      const run = state.dailyRuns.find(x => x.id === def.id);
      if (run) run.groupId = group.id;
    });
    state.dailyRuns.forEach(run => { run.date = new Date().toISOString(); run.status = "Ready"; });
    if (created) {
      persistState();
      renderAll();
      showToast(`Daily L300 runs initialized: ${created} route group(s) created.`);
    } else {
      persistState();
      renderDailyL300Runs();
      showToast("Daily L300 runs are ready and linked to Group Orders.");
    }
  }

  function setRunStatus(runId, status) {
    ensureDailyRunState();
    const run = state.dailyRuns.find(x => x.id === runId);
    if (!run) return;
    saveStateForUndo();
    run.status = status;
    run.date = new Date().toISOString();
    persistState();
    renderDailyL300Runs();
    showToast(`${run.name} · ${run.area}: ${status}.`);
  }

  function markRunOrderDelivered(runId, orderId) {
    ensureDailyRunState();
    const run = state.dailyRuns.find(x => x.id === runId);
    const order = state.orders.find(o => idEq(o.id, orderId));
    if (!run || !order) return;
    const group = groupForRun(run);
    if (!group || !(group.orderIds || []).some(id => idEq(id, orderId))) {
      showToast("Order is not assigned to this L300 Group Order.", "error");
      return;
    }
    saveStateForUndo();
    if (!Array.isArray(run.deliveredOrderIds)) run.deliveredOrderIds = [];
    if (!run.deliveredOrderIds.some(id => idEq(id, orderId))) run.deliveredOrderIds.push(orderId);
    order.deliveryStatus = "Delivered";
    order.deliveryRunId = run.id;
    order.deliveryDeliveredAt = new Date().toISOString();
    audit?.("update", "order", order.id, { source: "daily-l300-run", run: run.id, groupId: group.id, deliveryStatus: "Delivered" });
    persistState();
    renderAll();
    showToast(`Order #${order.orderNumber || order.id} marked delivered.`);
  }

  function moveRunOrder(runId, orderId, direction) {
    const run = state.dailyRuns.find(x => x.id === runId);
    if (!run) return;
    const rows = runOrders(run);
    const ids = rows.map(o => o.id);
    const index = ids.findIndex(id => idEq(id, orderId));
    if (index < 0) return;
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    saveStateForUndo();
    run.sequence = ids;
    run.date = new Date().toISOString();
    persistState();
    renderDailyL300Runs();
  }

  function renderDailyL300Runs() {
    const host = $("dailyL300Runs");
    if (!host) return;
    ensureDailyRunState();
    const today = new Date();
    const summary = RUN_DEFS.map(def => {
      const run = state.dailyRuns.find(x => x.id === def.id);
      const rows = runOrders(run);
      return { def, run, rows, m: metrics(rows, run), group: groupForRun(run) };
    });
    const totals = summary.reduce((a, x) => {
      a.orders += x.m.orders; a.gallons += x.m.gallons; a.revenue += x.m.revenue; a.paid += x.m.paid; a.receivable += x.m.receivable; a.delivered += x.m.delivered; return a;
    }, { orders:0, gallons:0, revenue:0, paid:0, receivable:0, delivered:0 });

    host.innerHTML = `
      <div class="card daily-l300-card">
        <div class="toolbar">
          <div><h3>🚚 TODAY · Daily L300 Delivery Runs</h3><p class="emp-meta">${today.toLocaleDateString([], {weekday:"long", month:"short", day:"numeric", year:"numeric"})} · Driven by existing Group Orders</p></div>
          <div class="btn-wrap"><button class="btn primary tiny" data-action="initializeDailyL300Runs">⚡ Initialize Runs</button><button class="btn ghost tiny" data-action="refreshDailyL300Runs">↻ Refresh</button></div>
        </div>
        <div class="stat-grid small daily-l300-summary">
          <div class="mini-card"><span class="mini-label">Orders</span><b>${totals.orders}</b></div>
          <div class="mini-card"><span class="mini-label">Containers</span><b>${totals.gallons}</b></div>
          <div class="mini-card"><span class="mini-label">Expected Revenue</span><b>${money(totals.revenue)}</b></div>
          <div class="mini-card"><span class="mini-label">Paid</span><b class="ok">${money(totals.paid)}</b></div>
          <div class="mini-card"><span class="mini-label">Receivable</span><b class="bad">${money(totals.receivable)}</b></div>
          <div class="mini-card"><span class="mini-label">Delivered</span><b>${totals.delivered}/${totals.orders}</b></div>
        </div>
        <div class="daily-l300-run-grid">
          ${summary.map(({def, run, rows, m, group}) => `
            <article class="daily-l300-run" data-run-id="${escRun(run.id)}">
              <div class="toolbar"><div><h4>🚚 ${escRun(def.name)} · ${escRun(def.area)}</h4><span class="badge soft">${escRun(def.timeWindow)} · ${escRun(run.status || "Ready")}</span><small class="emp-meta">📦 Group Orders: ${escRun(group?.name || "Not initialized")}</small></div><div class="btn-wrap"><button class="btn ghost tiny" data-action="setDailyL300RunStatus" data-action-args='[${jsAttrArg(run.id)},${jsAttrArg("En Route")}]'>▶ En Route</button><button class="btn ghost tiny" data-action="setDailyL300RunStatus" data-action-args='[${jsAttrArg(run.id)},${jsAttrArg("Completed")}]'>✓ Complete</button></div></div>
              <div class="stat-grid small"><div class="mini-card"><span class="mini-label">Orders</span><b>${m.orders}</b></div><div class="mini-card"><span class="mini-label">Gallons</span><b>${m.gallons}</b></div><div class="mini-card"><span class="mini-label">Expected</span><b>${money(m.revenue)}</b></div><div class="mini-card"><span class="mini-label">Paid</span><b class="ok">${money(m.paid)}</b></div><div class="mini-card"><span class="mini-label">Receivable</span><b class="bad">${money(m.receivable)}</b></div><div class="mini-card"><span class="mini-label">Containers Returned</span><b>${m.returned}</b></div></div>
              <div class="daily-l300-order-list">
                ${rows.length ? rows.map((o, i) => {
                  const delivered = (run.deliveredOrderIds || []).some(id => idEq(id, o.id)) || o.deliveryStatus === "Delivered";
                  return `<div class="group-order"><span><b>${i + 1}. ${escRun(o.clientName || "Client")}</b><br><small>${escRun(o.address || "No address")}</small><br><small>#${escRun(o.orderNumber)} · ${Number(o.gallons)||0} containers · ${money(o.total)} · ${escRun(o.status)}</small></span><span class="btn-wrap"><button class="btn ghost tiny" title="Move up" data-action="moveDailyL300Order" data-action-args='[${jsAttrArg(run.id)},${jsAttrArg(o.id)},-1]'>↑</button><button class="btn ghost tiny" title="Move down" data-action="moveDailyL300Order" data-action-args='[${jsAttrArg(run.id)},${jsAttrArg(o.id)},1]'>↓</button><button class="btn ${delivered ? "ghost" : "primary"} tiny" ${delivered ? "disabled" : ""} data-action="markDailyL300Delivered" data-action-args='[${jsAttrArg(run.id)},${jsAttrArg(o.id)}]'>${delivered ? "✓ Delivered" : "Deliver"}</button></span></div>`;
                }).join("") : '<div class="emp-meta" style="padding:12px 0;">No orders for today. Assign orders in Group Orders to this L300 run.</div>'}
              </div>
              <div class="row-btns"><button class="btn primary tiny block" data-action="openGroupManagerForDailyL300" data-action-args='[${jsAttrArg(run.id)}]'>📦 Manage Group Orders</button><button class="btn ghost tiny block" data-action="copyDailyL300Run" data-action-args='[${jsAttrArg(run.id)}]'>📋 Copy Run Sheet</button></div>
            </article>`;
          }).join("")}
        </div>
      </div>`;
  }

  function openGroupManagerForDailyL300(runId) {
    const run = state.dailyRuns.find(x => x.id === runId);
    const group = run && groupForRun(run);
    if (!group) { showToast("Initialize the daily runs first.", "error"); return; }
    const index = state.orderGroups.indexOf(group);
    if (index >= 0 && typeof openGroupManager === "function") openGroupManager(index);
  }

  function copyDailyL300Run(runId) {
    const run = state.dailyRuns.find(x => x.id === runId);
    if (!run) return;
    const group = groupForRun(run);
    const rows = runOrders(run);
    const m = metrics(rows, run);
    const text = [`${run.name} · ${run.area} · ${run.timeWindow}`, `Group Orders: ${group?.name || "Not initialized"}`, `Orders: ${m.orders} | Containers: ${m.gallons} | Expected: ${money(m.revenue)} | Paid: ${money(m.paid)} | Receivable: ${money(m.receivable)}`, "", ...rows.map((o, i) => `${i+1}. ${o.clientName || "Client"} — ${o.address || "No address"} — ${o.gallons || 0} containers — ${money(o.total)} — ${o.status}`)].join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showToast("Run sheet copied."));
    else prompt("Copy run sheet:", text);
  }

  function injectDailyL300Panel() {
    if ($("dailyL300Runs")) return;
    const dashboard = $("panel-dashboard");
    if (!dashboard) return;
    const anchor = dashboard.querySelector(".dashboard-today-ops") || dashboard.querySelector(".dashboard-overview");
    const host = document.createElement("div");
    host.id = "dailyL300Runs";
    if (anchor) anchor.insertAdjacentElement("beforebegin", host); else dashboard.prepend(host);
  }

  window.initializeDailyL300Runs = initializeRunGroups;
  window.refreshDailyL300Runs = renderDailyL300Runs;
  window.setDailyL300RunStatus = setRunStatus;
  window.markDailyL300Delivered = markRunOrderDelivered;
  window.moveDailyL300Order = moveRunOrder;
  window.openGroupManagerForDailyL300 = openGroupManagerForDailyL300;
  window.copyDailyL300Run = copyDailyL300Run;
  window.renderDailyL300Runs = renderDailyL300Runs;
  window.GV_DAILY_L300 = Object.freeze({ runDefinitions: RUN_DEFS.map(x => ({...x})) });

  function initDailyL300() {
    try {
      ensureDailyRunState();
      injectDailyL300Panel();
      renderDailyL300Runs();
    } catch (error) {
      console.warn("Daily L300 operating layer initialization skipped:", error?.message || error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initDailyL300, { once: true });
  else initDailyL300();
})();
