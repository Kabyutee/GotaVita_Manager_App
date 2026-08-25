/* GotaVita Manager — canonical remote field precedence bridge. */
(function () {
  "use strict";

  if (window.__GV_REMOTE_CANONICAL_FIELD_BRIDGE__) return;

  const TARGETS = new Set(["clients", "products", "employees"]);

  async function wrapSelectResource() {
    const gateway = window.GVData;
    if (!gateway || typeof gateway.selectResource !== "function") return false;
    if (gateway.selectResource.__gvCanonicalWrapped) return true;
    if (typeof gateway.getClient !== "function") return false;

    const original = gateway.selectResource.bind(gateway);

    const wrapped = async function (resource, options = {}) {
      const rows = await original(resource, options);
      if (!TARGETS.has(resource)) return rows;

      const client = gateway.getClient();
      if (!client) return rows;

      const { data, error } = await client.from(resource).select("*");
      if (error || !Array.isArray(data)) return rows;

      const byLegacyId = new Map(
        data
          .filter((row) => row?.legacy_id != null)
          .map((row) => [String(row.legacy_id), row])
      );

      return (Array.isArray(rows) ? rows : []).map((localRow) => {
        const raw = byLegacyId.get(String(localRow?.id ?? ""));
        if (!raw) return localRow;

        const next = { ...localRow };
        if (resource === "clients" || resource === "products") {
          next.active = raw.active !== false;
        }
        if (resource === "employees") {
          next.status = raw.status || "Active";
        }
        if (raw.updated_at) next.updatedAt = raw.updated_at;
        if (raw.created_at) next.createdAt = raw.created_at;
        if (raw.id) next.supabaseId = raw.id;
        return next;
      });
    };

    wrapped.__gvCanonicalWrapped = true;
    gateway.selectResource = wrapped;
    return true;
  }

  window.__GV_REMOTE_CANONICAL_FIELD_BRIDGE__ = true;

  const timer = setInterval(() => {
    wrapSelectResource().then((ready) => {
      if (ready) clearInterval(timer);
    }).catch(() => {});
  }, 100);

  wrapSelectResource().catch(() => {});
})();
