/* GotaVita Manager — Phase 5 Sprint 6 Step 10
 * Supabase Transaction Data Gateway
 *
 * Responsibilities:
 * - Provide the single cloud-data boundary for transaction data.
 * - Keep local-first operation when Supabase is unavailable.
 * - Never expose or use a Supabase service-role/secret key.
 * - Require an authenticated GotaVita manager for cloud operations.
 * - Rely on Supabase RLS for company-level authorization.
 * - Use resource-specific conflict keys that match the database schema.
 */

(function () {
  "use strict";

  const LEGACY_ID_RESOURCES = Object.freeze([
    "orders",
    "payments",
    "expenses",
    "payroll_records",
    "order_groups",
    "delivery_routes",
    "daily_reports",
    "deleted_orders"
  ]);

  const CHILD_RESOURCES = Object.freeze([
    "order_group_items",
    "delivery_route_items"
  ]);

  const TRANSACTION_RESOURCES = Object.freeze([
    ...LEGACY_ID_RESOURCES,
    ...CHILD_RESOURCES,
    "audit_logs"
  ]);

  const CONFLICT_KEYS = Object.freeze({
    orders: "company_id,legacy_id",
    payments: "company_id,legacy_id",
    expenses: "company_id,legacy_id",
    payroll_records: "company_id,legacy_id",
    order_groups: "company_id,legacy_id",
    delivery_routes: "company_id,legacy_id",
    daily_reports: "company_id,legacy_id",
    deleted_orders: "company_id,legacy_id",

    order_group_items: "company_id,group_legacy_id,order_legacy_id",
    delivery_route_items: "company_id,route_legacy_id,order_legacy_id"
  });

  let client = null;

  function config() {
    return window.GV_SUPABASE_CONFIG || {};
  }

  function isConfigured() {
    const cfg = config();

    return (
      typeof window.supabase !== "undefined" &&
      !!String(cfg.url || "").trim() &&
      !!String(cfg.publishableKey || "").trim()
    );
  }

  function getClient() {
    if (client) return client;

    if (!isConfigured()) return null;

    if (window.GVAuth?.getClient?.()) {
      client = window.GVAuth.getClient();
      return client;
    }

    const cfg = config();

    client = window.supabase.createClient(
      String(cfg.url).trim(),
      String(cfg.publishableKey).trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );

    return client;
  }

  async function requireAuthenticatedManager() {
    if (!isConfigured()) {
      return {
        configured: false,
        authenticated: false,
        profile: null,
        session: null
      };
    }

    if (window.GVAuth?.requireManagerSession) {
      const result = await window.GVAuth.requireManagerSession();

      if (!result?.authenticated) {
        throw new Error(
          "Manager authentication is required for cloud data access."
        );
      }

      return result;
    }

    const supabase = getClient();

    if (!supabase) {
      throw new Error("Supabase client is unavailable.");
    }

    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (!data?.session) {
      throw new Error(
        "Manager authentication is required for cloud data access."
      );
    }

    return {
      configured: true,
      authenticated: true,
      profile: null,
      session: data.session
    };
  }

  function assertResource(resource) {
    const name = String(resource || "").trim();

    if (!TRANSACTION_RESOURCES.includes(name)) {
      throw new Error(
        `Unsupported Supabase transaction resource: ${name}`
      );
    }

    return name;
  }

  function assertRows(rows) {
    const payload = Array.isArray(rows) ? rows : [rows];

    if (!payload.length) {
      return [];
    }

    for (const row of payload) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("Supabase gateway rows must be objects.");
      }
    }

    return payload;
  }

  async function selectResource(resource, options = {}) {
    const name = assertResource(resource);
    const supabase = getClient();

    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    await requireAuthenticatedManager();

    let query = supabase
      .from(name)
      .select("*");

    if (options.orderBy) {
      query = query.order(
        String(options.orderBy),
        {
          ascending: options.ascending !== false
        }
      );
    }

    if (
      Number.isInteger(options.limit) &&
      options.limit > 0
    ) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function upsertResource(resource, rows) {
    const name = assertResource(resource);
    const supabase = getClient();

    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    await requireAuthenticatedManager();

    const payload = assertRows(rows);

    if (!payload.length) return [];

    /*
     * Audit logs intentionally do not use upsert.
     * They are append-only records.
     */
    if (name === "audit_logs") {
      const { data, error } = await supabase
        .from(name)
        .insert(payload)
        .select("*");

      if (error) throw error;

      return Array.isArray(data) ? data : [];
    }

    const conflictKey = CONFLICT_KEYS[name];

    if (!conflictKey) {
      throw new Error(
        `No Supabase conflict key configured for resource: ${name}`
      );
    }

    const { data, error } = await supabase
      .from(name)
      .upsert(payload, {
        onConflict: conflictKey
      })
      .select("*");

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function insertResource(resource, rows) {
    const name = assertResource(resource);
    const supabase = getClient();

    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    await requireAuthenticatedManager();

    const payload = assertRows(rows);

    if (!payload.length) return [];

    const { data, error } = await supabase
      .from(name)
      .insert(payload)
      .select("*");

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function deleteResourceByLegacyId(resource, legacyId) {
    const name = assertResource(resource);
    const supabase = getClient();

    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    await requireAuthenticatedManager();

    if (!LEGACY_ID_RESOURCES.includes(name)) {
      throw new Error(
        `Resource ${name} does not support legacy_id deletion.`
      );
    }

    const id = String(legacyId || "").trim();

    if (!id) {
      throw new Error("A legacy record ID is required.");
    }

    const { data, error } = await supabase
      .from(name)
      .delete()
      .eq("legacy_id", id)
      .select("*");

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function deleteOrderGroupItem(groupLegacyId, orderLegacyId) {
    const supabase = getClient();

    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    await requireAuthenticatedManager();

    const groupId = String(groupLegacyId || "").trim();
    const orderId = String(orderLegacyId || "").trim();

    if (!groupId || !orderId) {
      throw new Error(
        "Both group_legacy_id and order_legacy_id are required."
      );
    }

    const { data, error } = await supabase
      .from("order_group_items")
      .delete()
      .eq("group_legacy_id", groupId)
      .eq("order_legacy_id", orderId)
      .select("*");

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function deleteDeliveryRouteItem(routeLegacyId, orderLegacyId) {
    const supabase = getClient();

    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    await requireAuthenticatedManager();

    const routeId = String(routeLegacyId || "").trim();
    const orderId = String(orderLegacyId || "").trim();

    if (!routeId || !orderId) {
      throw new Error(
        "Both route_legacy_id and order_legacy_id are required."
      );
    }

    const { data, error } = await supabase
      .from("delivery_route_items")
      .delete()
      .eq("route_legacy_id", routeId)
      .eq("order_legacy_id", orderId)
      .select("*");

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function insertAuditLog(entry) {
    const row = entry && typeof entry === "object"
      ? entry
      : {};

    return upsertResource("audit_logs", row);
  }

  async function health() {
    if (!isConfigured()) {
      return {
        ok: true,
        mode: "local",
        configured: false,
        authenticated: false
      };
    }

    try {
      const auth = await requireAuthenticatedManager();

      return {
        ok: true,
        mode: "supabase",
        configured: true,
        authenticated: !!auth?.authenticated,
        companyId: auth?.profile?.company_id || null
      };
    } catch (error) {
      return {
        ok: false,
        mode: "supabase",
        configured: true,
        authenticated: false,
        error: String(error?.message || error)
      };
    }
  }

  function getState() {
    return typeof window.state !== "undefined"
      ? window.state
      : null;
  }

  function persist() {
    if (typeof window.persistState === "function") {
      return window.persistState();
    }

    return false;
  }

  async function loadServer() {
    /*
     * Legacy Node/JSON loading is intentionally retired.
     * Cloud data will be loaded through the Supabase gateway.
     */
    if (!isConfigured()) {
      return false;
    }

    return false;
  }

  async function sync() {
    /*
     * Step 10 establishes the authoritative Supabase transaction
     * boundary. The existing application synchronization orchestrator
     * remains responsible for queue management until Step 10B.
     */
    if (!isConfigured()) {
      return {
        ok: false,
        mode: "local",
        status: "local-only"
      };
    }

    try {
      await requireAuthenticatedManager();

      return {
        ok: true,
        mode: "supabase",
        status: "gateway-ready"
      };
    } catch (error) {
      return {
        ok: false,
        mode: "supabase",
        status: "authentication-required",
        error: String(error?.message || error)
      };
    }
  }

  function backupList() {
    if (typeof window.readAutoBackupList === "function") {
      return window.readAutoBackupList();
    }

    return [];
  }

  window.GVData = Object.freeze({
    getState,
    persist,
    loadServer,
    sync,
    health,
    backupList,

    isConfigured,
    getClient,
    requireAuthenticatedManager,

    selectResource,
    upsertResource,
    insertResource,

    deleteResourceByLegacyId,
    deleteOrderGroupItem,
    deleteDeliveryRouteItem,

    insertAuditLog,

    transactionResources: () => [...TRANSACTION_RESOURCES],
    conflictKeys: () => ({ ...CONFLICT_KEYS })
  });
})();