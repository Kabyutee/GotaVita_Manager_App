/* GotaVita Manager — client directory safety boundary. */
(function () {
  "use strict";

  function install() {
    if (window.__GV_CLIENT_DIRECTORY_SAFETY__) return;
    if (typeof window.renderClientDirectory !== "function") return;
    const get = (id) => document.getElementById(id);
    const normalize = (value) => typeof window.normalizeSearchText === "function" ? window.normalizeSearchText(value) : String(value ?? "").toLowerCase().trim();
    const escSafe = (value) => typeof window.GV_UTILS?.esc === "function" ? window.GV_UTILS.esc(value) : String(value ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    const argSafe = (value) => typeof window.GV_UTILS?.jsAttrArg === "function" ? window.GV_UTILS.jsAttrArg(value) : JSON.stringify(String(value ?? ""));
    const pesoSafe = (value) => typeof window.GV_UTILS?.peso === "function" ? window.GV_UTILS.peso(value) : Number(value || 0).toLocaleString();
    function renderSafely() {
      try {
        const tb = get("clientTableBody");
        if (!tb) return;
        const snapshot = typeof window.getStateSnapshot === "function" ? window.getStateSnapshot() : null;
        const clients = Array.isArray(snapshot?.clients) ? snapshot.clients : [];
        const q = normalize(get("clientSearchInput")?.value || "");
        const group = get("clientGroupFilter")?.value || "";
        const rows = clients.filter((client) => {
          const archived = client?.active === false;
          const searchable = normalize([client?.name, client?.address, client?.phone, client?.group, archived ? "archived" : "active"].join(" "));
          return (!archived || Boolean(q)) && (!q || searchable.includes(q)) && (!group || client?.group === group);
        });
        const sort = window.sortConfig?.clients || { column: "name", asc: true };
        const dir = sort.asc ? 1 : -1;
        rows.sort((a, b) => {
          const ax = String(a?.[sort.column] ?? a?.name ?? "").toLowerCase();
          const bx = String(b?.[sort.column] ?? b?.name ?? "").toLowerCase();
          return ax < bx ? -dir : ax > bx ? dir : 0;
        });
        const activeCount = clients.filter((client) => client?.active !== false).length;
        const label = get("clientCountLabel");
        if (label) label.textContent = `(${rows.length} of ${activeCount} active)`;
        if (!rows.length) {
          tb.innerHTML = '<tr><td colspan="9" class="empty">No clients found.</td></tr>';
          return;
        }
        tb.innerHTML = rows.map((client) => {
          const archived = client?.active === false;
          let stats = { gallons: 0, emptyCollected: 0, outstandingContainers: 0, revenue: 0, due: 0 };
          try { if (typeof window.calculateClientStats === "function") stats = window.calculateClientStats(client) || stats; } catch (_) {}
          const heldClass = Number(stats.outstandingContainers) >= 10 ? "bad" : Number(stats.outstandingContainers) >= 5 ? "warn-t" : "ok";
          const dueClass = Number(stats.due) > 0 ? "bad" : "ok";
          const actions = archived
            ? `<button class="btn ghost tiny" data-action="openClientMiniPopup" data-action-args='[${argSafe(client?.name)}]'>View</button><span class="badge soft">Archived</span>`
            : `<button class="btn ghost tiny" data-action="openClientMiniPopup" data-action-args='[${argSafe(client?.name)}]'>View</button><button class="btn ghost tiny" data-action="editClient" data-action-args='[${argSafe(client?.id)}]'>Edit</button><button class="btn danger tiny" data-action="deleteClient" data-action-args='[${argSafe(client?.id)}]'>Archive</button>`;
          return `<tr><td><b style="cursor:pointer;color:var(--primary)" data-action="openClientMiniPopup" data-action-args='[${argSafe(client?.name)}]'>${escSafe(client?.name || "Unnamed client")}</b><br><span class="badge soft">${archived ? "Archived" : "Active"}</span><br><small>${escSafe(client?.phone || "")}</small></td><td><span class="badge soft">${escSafe(client?.group || "General")}</span></td><td><small>${escSafe(client?.address || "")}</small></td><td><b>${Number(stats.gallons) || 0}</b></td><td><b>${Number(stats.emptyCollected) || 0}</b></td><td><b class="${heldClass}">${Number(stats.outstandingContainers) || 0}</b></td><td><b>${pesoSafe(stats.revenue)}</b></td><td><b class="${dueClass}">${pesoSafe(stats.due)}</b></td><td><div class="row-btns">${actions}</div></td></tr>`;
        }).join("");
      } catch (error) {
        console.error("GotaVita client directory render:", error);
        const tb = get("clientTableBody");
        if (tb) tb.innerHTML = '<tr><td colspan="9" class="empty">Client directory could not be refreshed. Your saved data remains protected.</td></tr>';
      }
    }
    window.renderClientDirectory = renderSafely;
    window.__GV_CLIENT_DIRECTORY_SAFETY__ = true;
    renderSafely();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();
