// GotaVita Manager — Phase 4.5 Sprint M2
// Business-module extraction. Functions remain global for backward compatibility.


function renderPriceUpdater() {
  const el = $("priceUpdater"); if (!el) return;
  el.innerHTML = state.products.map((p) => `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px dashed var(--border); padding-bottom:8px;" class="animate__animated animate__fadeIn">
    <span><b style="font-size:1.05rem;">${esc(p.name)}</b><br><small class="emp-meta">${esc(p.category)}</small></span>
    <input type="number" value="${p.price}" style="width:90px; padding:0.5rem;" data-action="updateProductPrice" data-action-args='[${jsAttrArg(p.id)},"__VALUE__"]'>
  </div>`).join("");
}


function updateProductPrice(id, val) {
  const p = state.products.find((x) => idsEqual(x.id, id));
  if (!p) { showToast("Product record not found.", "error"); return; }
  const next = Number(val);
  if (!Number.isFinite(next) || next < 0 || next > 100000 || Math.abs((next / 0.5) - Math.round(next / 0.5)) > 1e-9) {
    showToast("Price must be a valid amount in 0.50 increments.", "error");
    renderPriceUpdater();
    return;
  }
  saveStateForUndo();
  p.price = next;
  p.updatedAt = new Date().toISOString();
  persistState();
  renderProductDropdowns();
  renderPriceUpdater();
  showToast("Price updated.");
}
