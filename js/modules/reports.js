// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.


function periodFinancials(period, reference = new Date()) {
  const { start, end } = getPeriodBounds(period, reference);
  const inRange = (date) => { const d = new Date(date); return d >= start && d <= end; };
  const revenue = state.orders.filter((o) => o.status === "Paid" && inRange(o.date)).reduce((s, o) => s + orderTotal(o), 0);
  const recordedExpenses = state.expenses.filter((x) => inRange(x.date) && !isEmployeeAdvance(x)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const payroll = estimatedPayroll(period);
  return { start, end, revenue, recordedExpenses, payroll, expenses: recordedExpenses + payroll, net: revenue - recordedExpenses - payroll };
}


function renderPeriodReport(period = "week") {
  const r = periodFinancials(period);
  const label = period === "month"
    ? r.start.toLocaleString([], { month: "long", year: "numeric" })
    : `${r.start.toLocaleDateString()} – ${r.end.toLocaleDateString()} (Mon–Sat)`;
  if ($("reportPeriodLabel")) $("reportPeriodLabel").textContent = period === "month" ? `Monthly Report · ${label}` : `Weekly Report · ${label}`;
  if ($("reportWeekBtn")) $("reportWeekBtn").className = "btn " + (period === "week" ? "primary" : "ghost") + " tiny";
  if ($("reportMonthBtn")) $("reportMonthBtn").className = "btn " + (period === "month" ? "primary" : "ghost") + " tiny";
  if ($("periodReportSummary")) $("periodReportSummary").innerHTML = `
    <div class="mini-card"><span class="mini-label">Revenue Collected</span><b class="ok">${peso(r.revenue)}</b></div>
    <div class="mini-card"><span class="mini-label">Recorded Expenses</span><b class="bad">${peso(r.recordedExpenses)}</b></div>
    <div class="mini-card"><span class="mini-label">Est. Payroll</span><b class="warn-t">${peso(r.payroll)}</b></div>
    <div class="mini-card"><span class="mini-label">Total Expenses</span><b>${peso(r.expenses)}</b></div>
    <div class="mini-card"><span class="mini-label">Net Result</span><b class="${r.net >= 0 ? "ok" : "bad"}">${peso(r.net)}</b></div>`;
}


function setReportPeriod(period) {
  const next = period === "month" ? "month" : "week";
  safeLocalStorageSet("water_report_period", next);
  renderPeriodReport(next);
}


function openPeriodReport(period) { setReportPeriod(period); switchTab("reports"); }

function saveDailyReport() {
  saveStateForUndo();
  const today = new Date();
  const rev = state.orders.filter((o) => o.status === "Paid" && sameDay(o.date, today)).reduce((s, o) => s + orderTotal(o), 0);
  const exp = state.expenses.filter((x) => sameDay(x.date, today) && !isEmployeeAdvance(x)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const note = ($("dailyReportNote")?.value.trim() || $("dailyReportNoteStandalone")?.value.trim() || "Daily Tally");
  state.dailyReports.push({ id: Date.now(), type: "Daily", date: today.toISOString(), revenue: rev, expense: exp, net: rev - exp, note });
  persistState(); renderDailyReports();
  if ($("dailyReportNote")) $("dailyReportNote").value = ""; if ($("dailyReportNoteStandalone")) $("dailyReportNoteStandalone").value = "";
  showToast("Daily report saved.");
}


function saveWeeklyReport() {
  saveStateForUndo();
  const r = periodFinancials("week");
  const note = $("dailyReportNote") && $("dailyReportNote").value.trim() ? $("dailyReportNote").value.trim() : `Mon-Sat Week Tally (${r.start.toLocaleDateString()} - ${r.end.toLocaleDateString()})`;
  state.dailyReports.push({ id: Date.now(), type: "Weekly", date: new Date().toISOString(), revenue: r.revenue, expense: r.expenses, net: r.net, note });
  persistState(); renderDailyReports();
  if ($("dailyReportNote")) $("dailyReportNote").value = ""; if ($("dailyReportNoteStandalone")) $("dailyReportNoteStandalone").value = "";
  showToast("Weekly report saved.");
}


function renderDailyReports() {
  const tb = $("dailyReportTableBody");
  const tb2 = $("dailyReportStandaloneTableBody");
  const now = new Date();
  const todayOrders = state.orders.filter(o=>sameDay(o.date, now));
  const todayRevenue = todayOrders.filter(o=>o.status==='Paid').reduce((a,o)=>a+(Number(o.total)||0),0);
  const todayExpense = state.expenses.filter(x=>sameDay(x.date, now) && !isEmployeeAdvance(x)).reduce((a,x)=>a+(Number(x.amount)||0),0);
  const todayContainers = todayOrders.reduce((a,o)=>a+(Number(o.gallons)||0),0);
  const todayEmpty = todayOrders.reduce((a,o)=>a+(Number(o.emptyGallonsCollected)||0),0);
  if ($("dailyTodayRevenue")) $("dailyTodayRevenue").textContent = peso(todayRevenue);
  if ($("dailyTodayExpense")) $("dailyTodayExpense").textContent = peso(todayExpense);
  if ($("dailyTodayNet")) $("dailyTodayNet").textContent = peso(todayRevenue-todayExpense);
  if ($("dailyTodayOrders")) $("dailyTodayOrders").textContent = String(todayOrders.length);
  if ($("dailyTodayContainers")) $("dailyTodayContainers").textContent = String(todayContainers);
  if ($("dailyTodayEmpty")) $("dailyTodayEmpty").textContent = String(todayEmpty);
  const reportRows = state.dailyReports.slice().reverse();
  const rowRenderer = (r) => `<tr class="${tableRenderClass(reportRows.length)}">
    <td><small>${new Date(r.date).toLocaleDateString()} ${new Date(r.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small></td>
    <td><span class="badge soft">${esc(r.type || "Daily")}</span></td>
    <td><b class="ok">${peso(r.revenue)}</b></td><td><b class="bad">-${peso(r.expense)}</b></td><td><b>${peso(r.net)}</b></td>
    <td><small>${esc(r.note) || "-"}</small></td><td><button class="btn danger tiny" data-action="deleteDailyReport" data-action-args='[${jsAttrArg(r.id)}]'>Del</button></td>
  </tr>`;
  const emptyReports = '<tr><td colspan="7" class="empty">No saved report snapshots.</td></tr>';
  if (tb) renderLazyList("dailyReportTableBody", reportRows, rowRenderer, emptyReports, { colspan: 7 });
  if (tb2) renderLazyList("dailyReportStandaloneTableBody", reportRows, rowRenderer, emptyReports, { colspan: 7 });
}


function renderDeletedArchives() {
  const tb = $("deletedTableBody"); if (!tb) return;
  if (!state.deletedOrders.length) { tb.innerHTML = `<tr><td colspan="4" class="empty">Archive is empty.</td></tr>`; return; }
  renderLazyList("deletedTableBody", state.deletedOrders.slice().reverse(), (o) => `<tr>
    <td>${esc(o.orderNumber)}</td><td>${esc(o.clientName)}</td><td>${peso(o.total)}</td>
    <td><button class="btn ghost tiny" data-action="restoreDeletedOrder" data-action-args='[${o.id}]'>Restore</button></td>
  </tr>`, '<tr><td colspan="4" class="empty">Archive is empty.</td></tr>', { colspan: 4 });
}


function renderAutoBackups() {
  const el = $("autoBackupList"); if (!el) return;
  const list = readAutoBackupList().slice().reverse();
  el.innerHTML = list.length ? list.map((b) => {
    const s = describeBackup(b) || {};
    return `<div class="group-order" style="padding:8px 0; border-bottom:1px dashed var(--border)">
      <span><small>${new Date(b.timestamp).toLocaleString()}</small><br><small class="emp-meta">${b.manual ? "manual" : "auto"} · ${s.clients || 0} clients · ${s.orders || 0} orders · ${s.expenses || 0} expenses</small></span>
      <button class="btn ghost tiny" data-action="restoreBackup" data-action-args='[${jsAttrArg(b.timestamp)}]'>Restore</button>
    </div>`;
  }).join("") : '<div class="emp-meta">No verified system backups yet.</div>';
}

function updateFinancialSummary() {
  const now = new Date(), week = periodFinancials("week", now), month = periodFinancials("month", now);
  let rev = 0, revT = 0, revW = week.revenue, revM = month.revenue, due = 0, dueN = 0, gal = 0, paid = 0, pending = 0, unpaid = 0, cancelled = 0;
  state.orders.forEach((o) => {
    gal += Number(o.gallons) || 0;
    if (o.status === "Paid") { paid++; rev += Number(o.total) || 0; if (sameDay(o.date, now)) revT += Number(o.total) || 0; }
    else { if (o.status === "Cancelled") cancelled++; else { due += Number(o.total) || 0; dueN++; if (o.status === "Pending") pending++; else unpaid++; } }
  });
  const recorded = state.expenses.filter((x) => !isEmployeeAdvance(x)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const payroll = estimatedPayroll("week");
  const exp = recorded + payroll;
  const expT = state.expenses.filter((x) => sameDay(x.date, now) && !isEmployeeAdvance(x)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  
  countUp($("sumRevenue"), rev, true);
  countUp($("sumExpense"), exp, true);
  countUp($("sumNet"), rev - exp, true);
  countUp($("sumReceivable"), due, true);
  
  if($("sumRevenueToday")) $("sumRevenueToday").textContent = `Today: ${peso(revT)} | Wk (Mon-Sat): ${peso(revW)} | Mo: ${peso(revM)}`;
  if($("sumExpenseToday")) $("sumExpenseToday").textContent = `Recorded: ${peso(recorded)} | Payroll: ${peso(payroll)}`;
  if($("sumNetToday")) $("sumNetToday").textContent = `Today: ${peso(revT - expT)} | Wk (Mon-Sat): ${peso(week.net)} | Mo: ${peso(month.net)}`;
  if($("sumReceivableCount")) $("sumReceivableCount").textContent = dueN + " open orders";
  
  countUp($("statTotalOrders"), state.orders.length, false);
  countUp($("statTotalGallons"), gal, false);
  const cm = containerMetrics();
  if ($("statEmptyCollected")) $("statEmptyCollected").textContent = cm.returned.toLocaleString();
  if($("statPaidCount")) $("statPaidCount").textContent = paid; 
  if($("statPendingCount")) $("statPendingCount").textContent = pending; 
  if($("statUnpaidCount")) $("statUnpaidCount").textContent = unpaid;
  if($("statCancelledCount")) $("statCancelledCount").textContent = cancelled;
  if($("dashboardContainersOut")) $("dashboardContainersOut").textContent = containerMetrics().outstanding;
}


function renderTodayOperations() {
  const now = new Date();
  const rows = state.orders.filter(o => sameDay(o.date, now));
  const counts = { paid:0, unpaid:0, pending:0, cancelled:0, gallons:0, returned:0 };
  rows.forEach(o => {
    const status = String(o.status || "Unpaid");
    if (status === "Paid") counts.paid++;
    else if (status === "Pending") counts.pending++;
    else if (status === "Cancelled") counts.cancelled++;
    else counts.unpaid++;
    counts.gallons += Number(o.gallons) || 0;
    counts.returned += Number(o.emptyGallonsCollected ?? o.emptyCollected ?? 0) || 0;
  });
  if ($("todayOpsDateLabel")) $("todayOpsDateLabel").textContent = now.toLocaleDateString([], { weekday:"long", month:"short", day:"numeric", year:"numeric" });
  if ($("todayOpsOrders")) $("todayOpsOrders").textContent = rows.length.toLocaleString();
  if ($("todayOpsPaid")) $("todayOpsPaid").textContent = counts.paid.toLocaleString();
  if ($("todayOpsUnpaid")) $("todayOpsUnpaid").textContent = counts.unpaid.toLocaleString();
  if ($("todayOpsPending")) $("todayOpsPending").textContent = counts.pending.toLocaleString();
  if ($("todayOpsGallons")) $("todayOpsGallons").textContent = counts.gallons.toLocaleString();
  if ($("todayOpsReturned")) $("todayOpsReturned").textContent = counts.returned.toLocaleString();
}


function renderRecentOrders() {
  const el = $("recentOrders"); if (!el) return;
  const rows = state.orders.slice(-8).reverse();
  el.innerHTML = rows.length ? rows.map((o) => `<div class="group-order animate__animated animate__fadeIn" style="padding:10px 0; border-bottom:1px dashed var(--border)">
    <span><b>#${esc(o.orderNumber)}</b> · ${esc(o.clientName)}<br><small class="emp-meta">${fmtDate(o.date)} · ${esc(o.custType)}</small></span>
    <span style="text-align:right"><b>${peso(o.total)}</b><br><span class="badge ${o.status.toLowerCase()}">${o.status}</span></span>
  </div>`).join("") : '<div class="emp-meta">No orders yet.</div>';
}


function containerMetrics() {
  const activeOrders = state.orders.filter(o => o.status !== "Cancelled");
  const delivered = activeOrders.reduce((s, o) => s + Math.max(Number(o.gallons) || 0, 0), 0);
  const returned = activeOrders.reduce((s, o) => s + Math.min(Math.max(Number(o.emptyGallonsCollected) || 0, 0), Math.max(Number(o.gallons) || 0, 0)), 0);
  const cancelled = state.orders.filter(o => o.status === "Cancelled").reduce((s, o) => s + Math.max(Number(o.gallons) || 0, 0), 0);
  return { delivered, returned, outstanding: Math.max(delivered - returned, 0), cancelled };
}
