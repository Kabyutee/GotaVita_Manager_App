// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.

function empDaysWorked(emp) {
  return DAYS.reduce((s, d) => s + (Number(emp.schedule && emp.schedule[d]) || 0), 0);
}


function isEmployeeAdvance(expense) {
  return expense && expense.expenseType === "Employee" && (
    String(expense.notes || "").toLowerCase().includes("cash advance") ||
    String(expense.category || "").toLowerCase() === "staff salary / meal"
  );
}


function empDeductions(emp) {
  return state.expenses.filter((e) => isEmployeeAdvance(e) && String(e.employeeId) === String(emp.id))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
}


function empGross(emp) {
  return emp.salaryType === "Monthly" ? emp.salaryRate
    : emp.salaryType === "Weekly" ? emp.salaryRate
      : emp.salaryRate * empDaysWorked(emp);
}


function renderEmployees() {
  const grid = $("employeeGridBody"); if (!grid) return;
  const q = normalizeSearchText($("empSearchInput").value || "");
  const pf = $("empPositionFilter").value, sf = $("empStatusFilter").value;
  let list = state.employees.slice();
  if (q) list = list.filter((e) => normalizeSearchText([e.name, e.position, e.phone, e.status || "Active"]).includes(q));
  if (pf) list = list.filter((e) => e.position === pf);
  if (sf) list = list.filter((e) => (e.status || "Active") === sf);
  const empSort = $("empSort")?.value || 'name-asc';

  let payroll = 0, daysLogged = 0, active = 0;
  state.employees.forEach((e) => {
    if ((e.status || "Active") === "Active") { active++; payroll += Math.max(empGross(e) - empDeductions(e), 0); }
    daysLogged += empDaysWorked(e);
  });

  const empSum = $("empSummary");
  if(empSum) {
    empSum.innerHTML = `
      <div class="mini-card animate__animated animate__zoomIn"><span class="mini-label">Headcount</span><b>${state.employees.length}</b></div>
      <div class="mini-card animate__animated animate__zoomIn"><span class="mini-label">Active Staff</span><b class="ok">${active}</b></div>
      <div class="mini-card animate__animated animate__zoomIn"><span class="mini-label">Days Logged (Mon–Sat)</span><b>${daysLogged}</b></div>
      <div class="mini-card animate__animated animate__zoomIn"><span class="mini-label">Net Payroll Due</span><b class="ok">${peso(payroll)}</b></div>`;
  }

  list.sort((a,b)=>{ const dir=empSort.endsWith('-desc')?-1:1; const key=empSort.startsWith('days')?'days':empSort.startsWith('net')?'net':'name'; const ax=key==='days'?empDaysWorked(a):key==='net'?Math.max(empGross(a)-empDeductions(a),0):a.name.toLowerCase(); const bx=key==='days'?empDaysWorked(b):key==='net'?Math.max(empGross(b)-empDeductions(b),0):b.name.toLowerCase(); return ax<bx?-dir:ax>bx?dir:0; });
  if (!list.length) { grid.innerHTML = `<p class="empty" style="grid-column:1/-1;">No staff members found.</p>`; return; }

  renderLazyList("employeeGridBody", list, (emp, i) => {
    const days = empDaysWorked(emp), ded = empDeductions(emp);
    const gross = empGross(emp), net = Math.max(gross - ded, 0);
    const initials = emp.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

    const chips = DAYS.map((d) => {
      const v = Number(emp.schedule[d]) || 0;
      const cls = v === 1 ? "full" : v === 0.5 ? "half" : "";
      const label = v === 1 ? "Full" : v === 0.5 ? "Half" : "Off";
      return `<button class="day-chip ${cls}" type="button" title="Cycle: Off → Full → Half" data-action="toggleEmployeeSchedule" data-action-args='[${jsAttrArg(emp.id)},${jsAttrArg(d)}]'><b>${d}</b>${label}</button>`;
    }).join("");

    return `<div class="emp-card animate__animated animate__fadeInUp ${(emp.status || "Active") === "Inactive" ? "inactive" : ""}">
      <div class="emp-top">
        <div class="avatar">${esc(initials)}</div>
        <div style="flex:1; min-width:0;">
          <div class="emp-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(emp.name)}</div>
          <div class="emp-meta">${esc(emp.position)} · ₱${emp.salaryRate}/${esc(emp.salaryType)} ${emp.phone ? "<br>" + esc(emp.phone) : ""}</div>
        </div>
        <span class="badge ${(emp.status || "Active") === "Active" ? "active" : "inactive"}">${esc(emp.status || "Active")}</span>
      </div>

      <div>
        <div class="emp-meta" style="margin-bottom:6px">Shift Schedule (Mon–Sat):</div>
        <div class="day-chips">${chips}</div>
      </div>

      <div class="emp-pay">
        <span>Days: <b>${days}</b></span>
        <span>Gross: <b>${peso(gross)}</b></span>
        <span>Advances: <b class="bad">-${peso(ded)}</b></span>
        <span>Net Due: <b class="ok">${peso(net)}</b></span>
      </div>

      <div class="emp-actions">
        <button class="btn primary tiny" data-action="viewPayslip" data-action-args='[${jsAttrArg(emp.id)}]'>🧾 Payslip</button>
        <button class="btn ghost tiny" data-action="addEmployeeAdvance" data-action-args='[${jsAttrArg(emp.id)}]'>💵 Adv.</button>
        <button class="btn ghost tiny" data-action="clearEmployeeWeek" data-action-args='[${jsAttrArg(emp.id)}]'>↺ Reset</button>
        <button class="btn ghost tiny" data-action="toggleEmployeeStatus" data-action-args='[${jsAttrArg(emp.id)}]'>${(emp.status || "Active") === "Active" ? "Deactivate" : "Activate"}</button>
        <button class="btn ghost tiny" data-action="editEmployee" data-action-args='[${jsAttrArg(emp.id)}]'>Edit</button>
        <button class="btn danger tiny" data-action="deleteEmployee" data-action-args='[${jsAttrArg(emp.id)}]'>Deactivate</button>
      </div>
    </div>`;
}
    , `<p class="empty" style="grid-column:1/-1;">No staff members found.</p>`, { initial: 24, chunk: 24 });
}


function toggleEmployeeSchedule(id, day) {
  saveStateForUndo();
  const e = state.employees.find((x) => String(x.id) === String(id)); if (!e) return;
  const cur = Number(e.schedule[day]) || 0;
  e.schedule[day] = cur === 0 ? 1 : cur === 1 ? 0.5 : 0;
  persistState(); renderPartial("employees");
}


function clearEmployeeWeek(id) {
  saveStateForUndo();
  const e = state.employees.find((x) => String(x.id) === String(id)); if (!e) return;
  DAYS.forEach((d) => (e.schedule[d] = 0));
  persistState(); renderPartial("employees"); showToast("Weekly schedule reset.");
}


function toggleEmployeeStatus(id) {
  saveStateForUndo();
  const e = state.employees.find((x) => String(x.id) === String(id)); if (!e) return;
  e.status = (e.status || "Active") === "Active" ? "Inactive" : "Active";
  persistState(); renderPartial("employees");
}


function addEmployeeAdvance(id) {
  const e = state.employees.find((x) => String(x.id) === String(id)); if (!e) return;
  const amt = parseFloat(prompt(`Cash advance / meal allowance for ${e.name} (₱):`, "200"));
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1000000) {
    if (!Number.isNaN(amt)) showToast("Enter a valid advance amount between ₱0.01 and ₱1,000,000.", "error");
    return;
  }
  saveStateForUndo();
  state.expenses.push({ id: Date.now(), expenseType: "Employee", employeeId: String(e.id), category: "Staff Salary / Meal", amount: amt, notes: "Cash Advance", date: new Date().toISOString() });
  persistState(); renderPartial("employees"); showToast(`Advance of ${peso(amt)} recorded for ${e.name}.`);
}


function handleEmployeeSubmit(e) {
  e.preventDefault();
  const name = $("empName").value.trim();
  const validation = validateEmployeeInput({ name, salaryType: $("empSalaryType").value, salaryRate: $("empSalaryRate").value });
  if (!validation.ok) { validationError(validation.message); return; }
  saveStateForUndo();
  const editId = $("editEmpId").value;
  const payload = {
    name: validation.value.name, position: $("empPosition").value, salaryType: $("empSalaryType").value,
    salaryRate: validation.value.salaryRate,
    phone: $("empPhone").value.trim(), status: $("empStatus").value
  };
  if (editId) {
    const emp = state.employees.find((x) => String(x.id) === String(editId));
    if (emp) Object.assign(emp, payload);
    showToast(`${name} updated.`);
  } else {
    state.employees.push(Object.assign({ id: "emp_" + Date.now(), schedule: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 } }, payload));
    showToast(`${name} added.`);
  }
  $("empFormWrapper").classList.remove("open");
  persistState(); resetEmployeeForm(); renderPartial("employees");
}


function editEmployee(id) {
  const e = state.employees.find((x) => String(x.id) === String(id)); if (!e) return;
  $("editEmpId").value = e.id; $("empName").value = e.name; $("empPosition").value = e.position;
  $("empSalaryType").value = e.salaryType; $("empSalaryRate").value = e.salaryRate;
  $("empPhone").value = e.phone || ""; $("empStatus").value = e.status || "Active";
  $("employeeFormTitle").textContent = "✏️ Edit Employee: " + e.name;
  $("saveEmpBtn").textContent = "Update Employee";
  $("cancelEmpEditBtn").style.display = "inline-flex";
  $("empFormWrapper").classList.add("open");
  switchTab("employees");
}


function resetEmployeeForm() {
  $("employeeForm").reset(); $("editEmpId").value = "";
  $("employeeFormTitle").textContent = "Add New Staff Member";
  $("saveEmpBtn").textContent = "Save Employee";
  $("cancelEmpEditBtn").style.display = "none";
}


function viewPayslip(id) {
  const e = state.employees.find((x) => String(x.id) === String(id)); if (!e) return;
  const days = empDaysWorked(e), ded = empDeductions(e);
  const gross = empGross(e), net = Math.max(gross - ded, 0);
  const sched = DAYS.filter((d) => e.schedule[d] > 0).map((d) => `${d}: ${e.schedule[d] === 1 ? "Full" : "Half"}`).join(" · ") || "No days logged";
  $("payslipContent").innerHTML = `
    <div style="text-align:center; margin-bottom:12px;">
      <h2>${BIZ_DETAILS.name}</h2>
      <div class="emp-meta">${BIZ_DETAILS.address}</div>
      <div class="emp-meta">Staff Payslip · ${new Date().toLocaleString()}</div>
    </div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Employee</span><b>${esc(e.name)}</b></div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Position</span><b>${esc(e.position)}</b></div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Salary Basis</span><b>${esc(e.salaryType)}</b></div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Rate</span><b>${peso(e.salaryRate)}</b></div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Mon–Sat Shift Log</span><b style="text-align:right">${esc(sched)}</b></div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Days Worked</span><b>${days}</b></div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Gross Pay</span><b>${peso(gross)}</b></div>
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);"><span>Advances / Deductions</span><b class="bad">-${peso(ded)}</b></div>
    <div style="display:flex; justify-content:space-between; padding:12px 0; font-size:1.2rem; font-weight:800; color:var(--primary); border-top:2px solid var(--primary); margin-top:10px;"><span>NET PAY DUE</span><span>${peso(net)}</span></div>`;
  openModal("payslipModal");
}

function getWeekStartMonSat(reference = new Date()) {
  const d = new Date(reference);
  const day = d.getDay(); 
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
  d.setDate(diff); d.setHours(0,0,0,0);
  return d;
}


function getPeriodBounds(period, reference = new Date()) {
  const d = new Date(reference);
  if (period === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  const start = getWeekStartMonSat(d);
  const end = new Date(start);
  // GotaVita operates Monday-Saturday; Sunday must not enter the weekly report.
  end.setDate(end.getDate() + 5);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}


function estimatedPayroll(period) {
  const active = state.employees.filter((e) => (e.status || "Active") === "Active");
  if (period === "month") return active.reduce((s, e) => s + Math.max(empGross(e), 0), 0);
  return active.reduce((s, e) => {
    const gross = e.salaryType === "Daily" ? e.salaryRate * empDaysWorked(e) : e.salaryType === "Weekly" ? e.salaryRate : e.salaryRate / 4.345;
    return s + Math.max(gross, 0);
  }, 0);
}
