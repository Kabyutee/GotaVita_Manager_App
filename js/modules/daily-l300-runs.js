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
  const escRun = value => typeof esc === "function" ? esc(value == null ? "" : String(value)) : String(value == null ? "" : value).replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const money = value => typeof peso === "function" ? peso(Number(value) || 0) : `₱${(Number(value) || 0).toFixed(2)}`;
  const sameDate = (a,b) => typeof sameDay === "function" ? sameDay(a,b) : new Date(a).toDateString() === new Date(b).toDateString();
  const idEq = (a,b) => String(a) === String(b);
  const activeOrder = o => o && o.status !== "Cancelled";

  function ensureDailyRunState() {
    if (!Array.isArray(state.dailyRuns)) state.dailyRuns = [];
    RUN_DEFS.forEach(def => {
      let run = state.dailyRuns.find(x => x.id === def.id);
      if (!run) { run = { id:def.id,name:def.name,area:def.area,timeWindow:def.timeWindow,groupId:def.groupId,status:"Ready",date:null,sequence:[],deliveredOrderIds:[],notes:"" }; state.dailyRuns.push(run); }
      run.name = def.name; run.area = def.area; run.timeWindow = def.timeWindow;
      if (!run.groupId) run.groupId = def.groupId;
      if (!Array.isArray(run.sequence)) run.sequence = [];
      if (!Array.isArray(run.deliveredOrderIds)) run.deliveredOrderIds = [];
    });
  }

  function groupForRun(run) {
    if (!run) return null;
    const byId = state.orderGroups.find(g => g && idEq(g.id, run.groupId));
    if (byId) return byId;
    const exact = state.orderGroups.find(g => String(g.name||"").trim().toLowerCase() === `${run.name} · ${run.area}`.toLowerCase());
    if (exact) { run.groupId = exact.id; return exact; }
    return state.orderGroups.find(g => String(g.name||"").trim().toLowerCase() === String(run.name||"").toLowerCase()) || null;
  }

  function runOrders(run) {
    const group = groupForRun(run);
    const ids = new Set(group ? (group.orderIds||[]).map(String) : []);
    const today = new Date();
    const rows = state.orders.filter(o => activeOrder(o) && ids.has(String(o.id)) && sameDate(o.date||today,today));
    const sequence = new Map((run.sequence||[]).map((id,i) => [String(id),i]));
    return rows.slice().sort((a,b) => {
      const ai = sequence.has(String(a.id)) ? sequence.get(String(a.id)) : 999999;
      const bi = sequence.has(String(b.id)) ? sequence.get(String(b.id)) : 999999;
      return ai - bi || String(a.clientName||"").localeCompare(String(b.clientName||""));
    });
  }

  function metrics(rows,run) {
    const revenue = rows.reduce((s,o)=>s+(Number(o.total)||0),0);
    const paid = rows.filter(o=>o.status==="Paid").reduce((s,o)=>s+(Number(o.total)||0),0);
    const gallons = rows.reduce((s,o)=>s+(Number(o.gallons)||0),0);
    const returned = rows.reduce((s,o)=>s+Math.min(Math.max(Number(o.emptyGallonsCollected??o.emptyCollected??0)||0,0),Math.max(Number(o.gallons)||0,0)),0);
    const delivered = rows.filter(o => (run.deliveredOrderIds||[]).some(id=>idEq(id,o.id)) || o.deliveryStatus === "Delivered").length;
    return {orders:rows.length,gallons,revenue,paid,receivable:Math.max(revenue-paid,0),returned,delivered};
  }

  function initializeRunGroups() {
    ensureDailyRunState(); let created = 0;
    RUN_DEFS.forEach(def => {
      let group = state.orderGroups.find(g=>idEq(g.id,def.groupId));
      if (!group) group = state.orderGroups.find(g=>String(g.name||"").trim().toLowerCase() === `${def.name} · ${def.area}`.toLowerCase());
      if (!group) { group={id:def.groupId,name:`${def.name} · ${def.area}`,orderIds:[]}; state.orderGroups.push(group); created++; }
      if (!group.id) group.id = def.groupId;
      const run = state.dailyRuns.find(x=>x.id===def.id); if (run) run.groupId = group.id;
    });
    state.dailyRuns.forEach(run=>{run.date=new Date().toISOString();run.status="Ready";});
    persistState();
    if (created) { renderAll(); showToast(`Daily L300 runs initialized: ${created} route group(s) created.`); }
    else { renderDailyL300Runs(); showToast("Daily L300 runs are ready and linked to Group Orders."); }
  }

  function setRunStatus(runId,status) {
    ensureDailyRunState(); const run=state.dailyRuns.find(x=>x.id===runId); if(!run)return;
    saveStateForUndo(); run.status=status; run.date=new Date().toISOString(); persistState(); renderDailyL300Runs();
    showToast(`${run.name} · ${run.area}: ${status}.`);
  }

  function markRunOrderDelivered(runId,orderId) {
    ensureDailyRunState(); const run=state.dailyRuns.find(x=>x.id===runId); const order=state.orders.find(o=>idEq(o.id,orderId)); const group=groupForRun(run);
    if(!run||!order||!group||!(group.orderIds||[]).some(id=>idEq(id,orderId))){showToast("Order is not assigned to this L300 Group Order.","error");return;}
    saveStateForUndo(); if(!Array.isArray(run.deliveredOrderIds))run.deliveredOrderIds=[];
    if(!run.deliveredOrderIds.some(id=>idEq(id,orderId)))run.deliveredOrderIds.push(orderId);
    order.deliveryStatus="Delivered"; order.deliveryRunId=run.id; order.deliveryDeliveredAt=new Date().toISOString();
    if(typeof audit === "function") audit("update","order",order.id,{source:"daily-l300-run",run:run.id,groupId:group.id,deliveryStatus:"Delivered"});
    persistState(); renderAll(); showToast(`Order #${order.orderNumber||order.id} marked delivered.`);
  }

  function moveRunOrder(runId,orderId,direction) {
    const run=state.dailyRuns.find(x=>x.id===runId); if(!run)return;
    const ids=runOrders(run).map(o=>o.id); const index=ids.findIndex(id=>idEq(id,orderId)); const next=index+direction;
    if(index<0||next<0||next>=ids.length)return; [ids[index],ids[next]]=[ids[next],ids[index]];
    saveStateForUndo(); run.sequence=ids; run.date=new Date().toISOString(); persistState(); renderDailyL300Runs();
  }

  function orderRowHtml(run,o,index) {
    const delivered=(run.deliveredOrderIds||[]).some(id=>idEq(id,o.id))||o.deliveryStatus==="Delivered";
    const argsUp=JSON.stringify([run.id,o.id,-1]).replace(/'/g,"&#39;"); const argsDown=JSON.stringify([run.id,o.id,1]).replace(/'/g,"&#39;"); const argsDeliver=JSON.stringify([run.id,o.id]).replace(/'/g,"&#39;");
    return '<div class="group-order"><span><b>'+(index+1)+'. '+escRun(o.clientName||"Client")+'</b><br><small>'+escRun(o.address||"No address")+'</small><br><small>#'+escRun(o.orderNumber)+' · '+(Number(o.gallons)||0)+' containers · '+money(o.total)+' · '+escRun(o.status)+'</small></span><span class="btn-wrap"><button class="btn ghost tiny" title="Move up" data-action="moveDailyL300Order" data-action-args=\''+argsUp+'\'>↑</button><button class="btn ghost tiny" title="Move down" data-action="moveDailyL300Order" data-action-args=\''+argsDown+'\'>↓</button><button class="btn '+(delivered?'ghost':'primary')+' tiny" '+(delivered?'disabled':'')+' data-action="markDailyL300Delivered" data-action-args=\''+argsDeliver+'\'>'+(delivered?'✓ Delivered':'Deliver')+'</button></span></div>';
  }

  function runCardHtml(def,run,rows,m,group) {
    const argsEnRoute=JSON.stringify([run.id,"En Route"]).replace(/'/g,"&#39;"); const argsComplete=JSON.stringify([run.id,"Completed"]).replace(/'/g,"&#39;"); const argsManage=JSON.stringify([run.id]).replace(/'/g,"&#39;"); const argsCopy=JSON.stringify([run.id]).replace(/'/g,"&#39;");
    const orders=rows.length?rows.map((o,i)=>orderRowHtml(run,o,i)).join(""):'<div class="emp-meta" style="padding:12px 0;">No orders for today. Assign orders in Group Orders to this L300 run.</div>';
    return '<article class="daily-l300-run" data-run-id="'+escRun(run.id)+'"><div class="toolbar"><div><h4>🚚 '+escRun(def.name)+' · '+escRun(def.area)+'</h4><span class="badge soft">'+escRun(def.timeWindow)+' · '+escRun(run.status||"Ready")+'</span><small class="emp-meta">📦 Group Orders: '+escRun(group?.name||"Not initialized")+'</small></div><div class="btn-wrap"><button class="btn ghost tiny" data-action="setDailyL300RunStatus" data-action-args=\''+argsEnRoute+'\'>▶ En Route</button><button class="btn ghost tiny" data-action="setDailyL300RunStatus" data-action-args=\''+argsComplete+'\'>✓ Complete</button></div></div><div class="stat-grid small"><div class="mini-card"><span class="mini-label">Orders</span><b>'+m.orders+'</b></div><div class="mini-card"><span class="mini-label">Gallons</span><b>'+m.gallons+'</b></div><div class="mini-card"><span class="mini-label">Expected</span><b>'+money(m.revenue)+'</b></div><div class="mini-card"><span class="mini-label">Paid</span><b class="ok">'+money(m.paid)+'</b></div><div class="mini-card"><span class="mini-label">Receivable</span><b class="bad">'+money(m.receivable)+'</b></div><div class="mini-card"><span class="mini-label">Containers Returned</span><b>'+m.returned+'</b></div></div><div class="daily-l300-order-list">'+orders+'</div><div class="row-btns"><button class="btn primary tiny block" data-action="openGroupManagerForDailyL300" data-action-args=\''+argsManage+'\'>📦 Manage Group Orders</button><button class="btn ghost tiny block" data-action="copyDailyL300Run" data-action-args=\''+argsCopy+'\'>📋 Copy Run Sheet</button></div></article>';
  }

  function renderDailyL300Runs() {
    const host=$("dailyL300Runs"); if(!host)return; ensureDailyRunState(); const today=new Date();
    const summary=RUN_DEFS.map(def=>{const run=state.dailyRuns.find(x=>x.id===def.id); const rows=runOrders(run); return {def,run,rows,m:metrics(rows,run),group:groupForRun(run)};});
    const totals=summary.reduce((a,x)=>({orders:a.orders+x.m.orders,gallons:a.gallons+x.m.gallons,revenue:a.revenue+x.m.revenue,paid:a.paid+x.m.paid,receivable:a.receivable+x.m.receivable,delivered:a.delivered+x.m.delivered}),{orders:0,gallons:0,revenue:0,paid:0,receivable:0,delivered:0});
    const cards=summary.map(x=>runCardHtml(x.def,x.run,x.rows,x.m,x.group)).join("");
    host.innerHTML='<div class="card daily-l300-card"><div class="toolbar"><div><h3>🚚 TODAY · Daily L300 Delivery Runs</h3><p class="emp-meta">'+today.toLocaleDateString([],{weekday:"long",month:"short",day:"numeric",year:"numeric"})+' · Driven by existing Group Orders</p></div><div class="btn-wrap"><button class="btn primary tiny" data-action="initializeDailyL300Runs">⚡ Initialize Runs</button><button class="btn ghost tiny" data-action="refreshDailyL300Runs">↻ Refresh</button></div></div><div class="stat-grid small daily-l300-summary"><div class="mini-card"><span class="mini-label">Orders</span><b>'+totals.orders+'</b></div><div class="mini-card"><span class="mini-label">Containers</span><b>'+totals.gallons+'</b></div><div class="mini-card"><span class="mini-label">Expected Revenue</span><b>'+money(totals.revenue)+'</b></div><div class="mini-card"><span class="mini-label">Paid</span><b class="ok">'+money(totals.paid)+'</b></div><div class="mini-card"><span class="mini-label">Receivable</span><b class="bad">'+money(totals.receivable)+'</b></div><div class="mini-card"><span class="mini-label">Delivered</span><b>'+totals.delivered+'/'+totals.orders+'</b></div></div><div class="daily-l300-run-grid">'+cards+'</div></div>';
  }

  function openGroupManagerForDailyL300(runId){const run=state.dailyRuns.find(x=>x.id===runId);const group=run&&groupForRun(run);if(!group){showToast("Initialize the daily runs first.","error");return;}const index=state.orderGroups.indexOf(group);if(index>=0&&typeof openGroupManager==="function")openGroupManager(index);}
  function copyDailyL300Run(runId){const run=state.dailyRuns.find(x=>x.id===runId);if(!run)return;const group=groupForRun(run);const rows=runOrders(run);const m=metrics(rows,run);const text=[`${run.name} · ${run.area} · ${run.timeWindow}`,`Group Orders: ${group?.name||"Not initialized"}`,`Orders: ${m.orders} | Containers: ${m.gallons} | Expected: ${money(m.revenue)} | Paid: ${money(m.paid)} | Receivable: ${money(m.receivable)}`,"",...rows.map((o,i)=>`${i+1}. ${o.clientName||"Client"} — ${o.address||"No address"} — ${o.gallons||0} containers — ${money(o.total)} — ${o.status}`)].join("\n");if(navigator.clipboard)navigator.clipboard.writeText(text).then(()=>showToast("Run sheet copied."));else prompt("Copy run sheet:",text);}
  function injectDailyL300Panel(){if($("dailyL300Runs"))return;const dashboard=$("panel-dashboard");if(!dashboard)return;const anchor=dashboard.querySelector(".dashboard-today-ops")||dashboard.querySelector(".dashboard-overview");const host=document.createElement("div");host.id="dailyL300Runs";if(anchor)anchor.insertAdjacentElement("beforebegin",host);else dashboard.prepend(host);}

  window.initializeDailyL300Runs=initializeRunGroups;
  window.refreshDailyL300Runs=renderDailyL300Runs;
  window.setDailyL300RunStatus=setRunStatus;
  window.markDailyL300Delivered=markRunOrderDelivered;
  window.moveDailyL300Order=moveRunOrder;
  window.openGroupManagerForDailyL300=openGroupManagerForDailyL300;
  window.copyDailyL300Run=copyDailyL300Run;
  window.renderDailyL300Runs=renderDailyL300Runs;
  window.GV_DAILY_L300=Object.freeze({runDefinitions:RUN_DEFS.map(x=>({...x}))});

  function initDailyL300(){try{ensureDailyRunState();injectDailyL300Panel();renderDailyL300Runs();}catch(error){console.warn("Daily L300 operating layer initialization skipped:",error?.message||error);}}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initDailyL300,{once:true});else initDailyL300();
})();