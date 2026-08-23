/* GotaVita Manager — L300 reporting adapter
 * Read-only reporting projection over dailyRuns + existing Orders.
 * Does not mutate orders, groups, routes, or run state.
 */
(function () {
  "use strict";

  function sameDaySafe(a, b) {
    return typeof sameDay === "function"
      ? sameDay(a, b)
      : new Date(a).toDateString() === new Date(b).toDateString();
  }

  function runDefinitions() {
    return window.GV_DAILY_L300?.runDefinitions || [
      { id: "masagana-alabang", name: "MASAGANA", area: "ALABANG", timeWindow: "Morning" },
      { id: "atc-alabang", name: "ATC", area: "ALABANG", timeWindow: "After Lunch" },
      { id: "festival-alabang", name: "FESTIVAL", area: "ALABANG", timeWindow: "Before Dinner" }
    ];
  }

  function rowsForRun(run, reference) {
    const group = state.orderGroups.find(g => String(g.name || "").trim().toLowerCase() === `${run.name} · ${run.area}`.toLowerCase())
      || state.orderGroups.find(g => String(g.name || "").trim().toLowerCase() === run.name.toLowerCase());
    const ids = new Set((group?.orderIds || []).map(String));
    const byRun = state.orders.filter(o => o.status !== "Cancelled" && o.deliveryRunId === run.id && sameDaySafe(o.date || reference, reference));
    const grouped = state.orders.filter(o => o.status !== "Cancelled" && ids.has(String(o.id)) && sameDaySafe(o.date || reference, reference));
    const merged = new Map();
    [...grouped, ...byRun].forEach(o => merged.set(String(o.id), o));
    const sequence = new Map((run.sequence || []).map((id, i) => [String(id), i]));
    return Array.from(merged.values()).sort((a, b) => {
      const ai = sequence.has(String(a.id)) ? sequence.get(String(a.id)) : 999999;
      const bi = sequence.has(String(b.id)) ? sequence.get(String(b.id)) : 999999;
      return ai - bi || String(a.clientName || "").localeCompare(String(b.clientName || ""));
    });
  }

  function summarizeRows(rows, run) {
    const revenue = rows.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const paid = rows.filter(o => o.status === "Paid").reduce((s, o) => s + (Number(o.total) || 0), 0);
    const gallons = rows.reduce((s, o) => s + (Number(o.gallons) || 0), 0);
    const returned = rows.reduce((s, o) => s + Math.min(Math.max(Number(o.emptyGallonsCollected ?? o.emptyCollected ?? 0) || 0, 0), Math.max(Number(o.gallons) || 0, 0)), 0);
    const delivered = rows.filter(o => (run.deliveredOrderIds || []).some(id => String(id) === String(o.id)) || o.deliveryStatus === "Delivered").length;
    return { orders: rows.length, gallons, expectedRevenue: revenue, paid, receivable: Math.max(revenue - paid, 0), containersReturned: returned, delivered, pendingDelivery: Math.max(rows.length - delivered, 0) };
  }

  function daily(reference = new Date()) {
    const runs = (Array.isArray(state.dailyRuns) ? state.dailyRuns : []).filter(Boolean);
    const byId = new Map(runs.map(run => [String(run.id), run]));
    const details = runDefinitions().map(def => {
      const run = byId.get(String(def.id)) || { ...def, sequence: [], deliveredOrderIds: [] };
      return { id: def.id, name: def.name, area: def.area, timeWindow: run.timeWindow || def.timeWindow, status: run.status || "Ready", ...summarizeRows(rowsForRun(run, reference), run) };
    });
    return details.reduce((report, run) => {
      report.runs.push(run); report.orders += run.orders; report.gallons += run.gallons; report.expectedRevenue += run.expectedRevenue; report.paid += run.paid; report.receivable += run.receivable; report.containersReturned += run.containersReturned; report.delivered += run.delivered; report.pendingDelivery += run.pendingDelivery;
      return report;
    }, { date: new Date(reference).toISOString(), runs: [], orders: 0, gallons: 0, expectedRevenue: 0, paid: 0, receivable: 0, containersReturned: 0, delivered: 0, pendingDelivery: 0 });
  }

  function period(period, reference = new Date()) {
    const bounds = typeof getPeriodBounds === "function" ? getPeriodBounds(period, reference) : { start: reference, end: reference };
    const rows = state.orders.filter(o => o.status !== "Cancelled" && new Date(o.date) >= bounds.start && new Date(o.date) <= bounds.end);
    const revenue = rows.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const paid = rows.filter(o => o.status === "Paid").reduce((s, o) => s + (Number(o.total) || 0), 0);
    return { period, start: bounds.start, end: bounds.end, orders: rows.length, gallons: rows.reduce((s, o) => s + (Number(o.gallons) || 0), 0), expectedRevenue: revenue, paid, receivable: Math.max(revenue - paid, 0) };
  }

  window.GV_L300_REPORTING = Object.freeze({ daily, period });
  window.dispatchEvent(new CustomEvent("gv:l300-reporting-ready"));
})();
