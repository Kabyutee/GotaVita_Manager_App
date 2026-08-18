// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.


function quickAddClient() {
  const name = $("qcName").value.trim();
  const duplicate = state.clients.find(c => String(c.name || "").trim().toLowerCase() === name.toLowerCase());
  const validation = validateClientInput({ name, defaultPrice: $("qcPrice").value, address: $("qcAddress").value });
  if (!validation.ok) { validationError(validation.message); return; }
  if (duplicate) { validationError("A client with that name already exists."); return; }
  saveStateForUndo();
  state.clients.push({ id: Date.now(), name: validation.value.name, group: $("qcGroup").value, phone: "", address: validation.value.address, defaultPrice: validation.value.defaultPrice });
  persistState(); renderPartial("clients");
  $("qcName").value = ""; $("qcAddress").value = "";
  $("clientSelect").value = name; autofillClientPrice();
  showToast(`Client ${name} added.`);
}

function toggleEmployeeExpense() {
  const div = $("employeeExpenseDiv");
  if(div) div.style.display = $("expenseType").value === "Employee" ? "flex" : "none";
}


function handleExpenseSubmit(e) {
  e.preventDefault();
  const amount = parseFloat($("expenseAmount").value);
  const validation = validateExpenseInput({ amount, expenseType: $("expenseType").value, employeeId: $("expenseEmployeeId").value, category: $("expenseCategory").value });
  if (!validation.ok) { validationError(validation.message); return; }
  saveStateForUndo();
  const type = $("expenseType").value;
  const editId = $("editExpenseId").value;
  const payload = {
    expenseType: type,
    employeeId: type === "Employee" ? $("expenseEmployeeId").value : "",
    category: $("expenseCategory").value,
    amount,
    notes: $("expenseNotes").value.trim()
  };
  if (editId) {
    const expense = state.expenses.find((x) => String(x.id) === String(editId));
    if (expense) Object.assign(expense, payload);
    showToast("Expense updated.");
  } else {
    state.expenses.push(Object.assign({ id: Date.now(), date: new Date().toISOString() }, payload));
    showToast("Expense recorded.");
  }
  persistState(); renderPartial("expenses"); resetExpenseForm();
}


function editExpense(id) {
  const x = state.expenses.find((e) => String(e.id) === String(id)); if (!x) return;
  $("editExpenseId").value = x.id;
  $("expenseType").value = x.expenseType || "Company";
  toggleEmployeeExpense();
  $("expenseEmployeeId").value = x.employeeId || "";
  $("expenseCategory").value = x.category || "Others";
  $("expenseAmount").value = x.amount || "";
  $("expenseNotes").value = x.notes || "";
  $("expenseFormTitle").textContent = "✏️ Edit Expense";
  $("saveExpenseBtn").textContent = "Update Expense";
  $("cancelExpenseEditBtn").style.display = "inline-flex";
  switchTab("expenses");
}


function resetExpenseForm() {
  $("expenseForm").reset();
  $("editExpenseId").value = "";
  $("expenseFormTitle").textContent = "💸 Record Expense";
  $("saveExpenseBtn").textContent = "Save Expense";
  $("cancelExpenseEditBtn").style.display = "none";
  toggleEmployeeExpense();
}


function getDateFilterRange(filter, fromValue = "", toValue = "") {
  const now = new Date();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
  const today = startOfDay(now);
  if (filter === "today") return { start: today, end: endOfDay(now) };
  if (filter === "yesterday") { const d = new Date(today); d.setDate(d.getDate()-1); return { start: startOfDay(d), end: endOfDay(d) }; }
  if (filter === "week") {
    const d = new Date(today); const day = d.getDay(); const diff = day === 0 ? 6 : day - 1; d.setDate(d.getDate()-diff);
    const end = new Date(d); end.setDate(end.getDate()+5);
    return { start: startOfDay(d), end: endOfDay(end) };
  }
  if (filter === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0,0), end: new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999) };
  if (filter === "custom" && (fromValue || toValue)) {
    const start = fromValue ? startOfDay(new Date(`${fromValue}T00:00:00`)) : null;
    const end = toValue ? endOfDay(new Date(`${toValue}T00:00:00`)) : null;
    return { start, end };
  }
  return null;
}


function matchesDateFilter(iso, filter, fromValue = "", toValue = "") {
  const range = getDateFilterRange(filter, fromValue, toValue);
  if (!range) return true;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
}


function handleExpenseDateFilterChange() {
  const custom = $("expenseDateFilter")?.value === "custom";
  if ($("expenseDateFrom")) $("expenseDateFrom").style.display = custom ? "inline-block" : "none";
  if ($("expenseDateTo")) $("expenseDateTo").style.display = custom ? "inline-block" : "none";
  renderExpenseLog();
}


function renderExpenseLog() {
  const tb = $("expenseTableBody"); if (!tb) return;
  const q = normalizeSearchText($("expenseSearchInput").value || "");
  let rows = state.expenses.slice();
  const ef = $("expenseDateFilter")?.value || "all";
  rows = rows.filter(x => matchesDateFilter(x.date, ef, $("expenseDateFrom")?.value || "", $("expenseDateTo")?.value || ""));
  if (q) rows = rows.filter((x) => normalizeSearchText([x.category, x.notes, x.expenseType]).includes(q));
  const total = state.expenses.reduce((s, x) => s + (x.amount || 0), 0);
  const totLabel = $("expenseTotalLabel");
  if(totLabel) totLabel.textContent = `(Total: ${peso(total)})`;
  const esort=$("expenseSort")?.value || 'date-desc';
  const [sortKey, sortDir] = esort.split('-');
  const dir = sortDir === 'desc' ? -1 : 1;
  const valueFor = (x) => {
    if(sortKey === 'date') return new Date(x.date).getTime() || 0;
    if(sortKey === 'amount') return Number(x.amount) || 0;
    return String(x.category || '').toLowerCase();
  };
  rows.sort((a,b)=>{
    const ax=valueFor(a), bx=valueFor(b);
    if(ax===bx) return 0;
    return ax<bx ? -1*dir : 1*dir;
  });
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="6" class="empty">No expenses recorded.</td></tr>`; return; }
  renderLazyList("expenseTableBody", rows, (x) => {
    const emp = state.employees.find((e) => String(e.id) === String(x.employeeId));
    return `<tr class="${tableRenderClass(rows.length)}">
      <td><small>${fmtDate(x.date)}</small></td>
      <td><span class="badge soft">${esc(x.expenseType)}</span>${emp ? `<br><small>${esc(emp.name)}</small>` : ""}</td>
      <td>${esc(x.category)}</td>
      <td><b class="bad">-${peso(x.amount)}</b></td>
      <td><small>${esc(x.notes) || "-"}</small></td>
      <td>
        <button class="btn ghost tiny" data-action="editExpense" data-action-args='[${x.id}]'>Edit</button>
        <button class="btn danger tiny" data-action="deleteExpense" data-action-args='[${x.id}]'>Del</button>
      </td>
    </tr>`;
  }, `<tr><td colspan="6" class="empty">No expenses recorded.</td></tr>`, { colspan: 6 });
}


function sortExpenses(mode) {
  const el=$("expenseSort");
  if(!el) return;
  el.value=mode;
  renderExpenseLog();
}
