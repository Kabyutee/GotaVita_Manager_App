/* GotaVita Manager — L300 Operations Dashboard
 * Presentation-only layer over the existing Daily L300 operating layer
 * and read-only reporting adapter. No business records are mutated here.
 */
(function () {
  "use strict";

  const RUNS = [
    { id: "masagana-alabang", name: "MASAGANA", area: "ALABANG" },
    { id: "atc-alabang", name: "ATC", area: "ALABANG" },
    { id: "festival-alabang", name: "FESTIVAL", area: "ALABANG" }
  ];

  const money = value => typeof peso === "function" ? peso(Number(value) || 0) : `₱${(Number(value) || 0).toFixed(2)}`;
  const escSafe = value => typeof esc === "function" ? esc(value == null ? "" : String(value)) : String(value == null ? "" : value);

  function injectStyles() {
    if ($("l300OperationsDashboardStyles")) return;
    const style = document.createElement("style");
    style.id = "l300OperationsDashboardStyles";
    style.textContent = `
      .l300-ops-shell{display:grid;gap:16px}
      .l300-ops-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .l300-run-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
      .l300-run-card{border:1px solid var(--border);border-radius:var(--radius);padding:14px;background:var(--card);min-width:0}
      .l300-run-card h4{margin:0 0 3px}
      .l300-metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
      .l300-metric{padding:9px;border-radius:var(--radius-sm);background:var(--surface);border:1px solid var(--border)}
      .l300-metric span{display:block;font-size:.72rem;color:var(--muted)}
      .l300-metric b{display:block;margin-top:3px;font-size:.95rem}
      .l300-period-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .l300-run-card .badge{margin-top:5px}
      @media(max-width:900px){.l300-run-grid,.l300-period-grid{grid-template-columns:1fr}.l300-metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    if ($("panel-l300")) return $("panel-l300");
    const main = $("mainContent");
    const anchor = $("panel-neworder");
    if (!main) return null;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "panel-l300";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `<div class="l300-ops-shell" id="l300OperationsDashboard"></div>`;
    if (anchor) main.insertBefore(panel, anchor); else main.appendChild(panel);
    return panel;
  }

  function ensureTab() {
    if ($('[data-tab="l300"]')) return;
    const tabs = $("tabs");
    if (!tabs) return;
    const button = document.createElement("button");
    button.className = "tab";
    button.type = "button";
    button.role = "tab";
    button.dataset.tab = "l300";
    button.dataset.action = "switchTab";
    button.dataset.actionArgs = '["l300"]';
    button.setAttribute("aria-selected", "false");
    button.setAttribute("tabindex", "-1");
    button.setAttribute("aria-controls", "panel-l300");
    button.textContent = "🚚 L300 Today";
    const reportsTab = tabs.querySelector('[data-tab="reports"]');
    tabs.insertBefore(button, reportsTab || tabs.querySelector(".tab-underline"));
  }

  function getDaily() {
    return typeof window.GV_L300_REPORTING?.daily === "function" ? window.GV_L300_REPORTING.daily(new Date()) : null;
  }

  function getPeriods() {
    const adapter = window.GV_L300_REPORTING;
    if (!adapter?.period) return [];
    return ["week", "month"].map(period => adapter.period(period, new Date()));
  }

  function runCard(run) {
    return `<article class="l300-run-card">
      <h4>🚚 ${escSafe(run.name)} · ${escSafe(run.area)}</h4>
      <span class="badge soft">${escSafe(run.status || "Ready")}</span>
      <div class="l300-metric-grid">
        <div class="l300-metric"><span>Orders</span><b>${run.orders}</b></div>
        <div class="l300-metric"><span>Gallons</span><b>${run.gallons}</b></div>
        <div class="l300-metric"><span>Expected</span><b>${money(run.expectedRevenue)}</b></div>
        <div class="l300-metric"><span>Paid</span><b class="ok">${money(run.paid)}</b></div>
        <div class="l300-metric"><span>Receivable</span><b class="bad">${money(run.receivable)}</b></div>
        <div class="l300-metric"><span>Delivery</span><b>${run.delivered}/${run.orders}</b></div>
      </div>
    </article>`;
  }

  function render() {
    const host = $("l300OperationsDashboard");
    if (!host || !window.state) return;
    const daily = getDaily();
    if (!daily) {
      host.innerHTML = `<div class="card"><h3>🚚 L300 Today</h3><p class="emp-meta">Reporting adapter is not available yet.</p></div>`;
      return;
    }
    const periods = getPeriods();
    host.innerHTML = `
      <div class="card">
        <div class="l300-ops-header">
          <div><h2 style="margin:0">🚚 TODAY · L300 Operations</h2><p class="emp-meta">Three delivery runs using the existing Orders + Routes data.</p></div>
          <div class="btn-wrap"><button class="btn primary tiny" data-action="refreshDailyL300Runs">↻ Refresh Runs</button><button class="btn ghost tiny" data-action="switchTab" data-action-args='["groups"]'>📦 Manage Routes</button></div>
        </div>
        <div class="stat-grid small" style="margin-top:14px">
          <div class="mini-card"><span class="mini-label">Orders</span><b>${daily.orders}</b></div>
          <div class="mini-card"><span class="mini-label">Gallons</span><b>${daily.gallons}</b></div>
          <div class="mini-card"><span class="mini-label">Expected Revenue</span><b>${money(daily.expectedRevenue)}</b></div>
          <div class="mini-card"><span class="mini-label">Paid</span><b class="ok">${money(daily.paid)}</b></div>
          <div class="mini-card"><span class="mini-label">Receivable</span><b class="bad">${money(daily.receivable)}</b></div>
          <div class="mini-card"><span class="mini-label">Delivered</span><b>${daily.delivered}/${daily.orders}</b></div>
        </div>
      </div>
      <div class="l300-run-grid">${daily.runs.map(runCard).join("")}</div>
      <div class="card">
        <div class="l300-ops-header"><div><h3>📈 Reporting Outlook</h3><p class="emp-meta">Same read-only reporting projection, aggregated by period.</p></div></div>
        <div class="l300-period-grid">
          ${periods.map(p => `<div class="mini-card"><span class="mini-label">${p.period === "week" ? "Weekly" : "Monthly"}</span><b>${p.orders} orders · ${p.gallons} gallons</b><small>${money(p.expectedRevenue)} expected · ${money(p.paid)} paid · ${money(p.receivable)} receivable</small></div>`).join("")}
        </div>
      </div>
    `;
  }

  function init() {
    try {
      injectStyles();
      ensureTab();
      ensurePanel();
      render();
      const originalPersist = window.persistState;
      if (typeof originalPersist === "function" && !originalPersist.__l300DashboardWrapped) {
        const wrapped = function () {
          const result = originalPersist.apply(this, arguments);
          try { render(); } catch (_) {}
          return result;
        };
        wrapped.__l300DashboardWrapped = true;
        window.persistState = wrapped;
      }
      document.addEventListener("click", event => {
        const tab = event.target.closest?.('[data-tab="l300"]');
        if (tab) setTimeout(render, 0);
      });
    } catch (error) {
      console.warn("L300 operations dashboard initialization skipped:", error?.message || error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  window.renderL300OperationsDashboard = render;
})();