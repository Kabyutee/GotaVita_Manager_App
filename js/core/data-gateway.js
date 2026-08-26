/* GotaVita Manager — Phase 5 Sprint 6
 * Supabase Transaction Data Gateway
 *
 * Responsibilities:
 * - Single authenticated Supabase client owned by GVAuth.
 * - Local camelCase <-> Supabase snake_case adapter.
 * - Stable GotaVita legacy IDs stored as TEXT.
 * - Supabase UUIDs remain database-owned identifiers.
 * - Company ownership always uses UUID company_id.
 * - RLS remains the authorization boundary.
 * - No service-role or secret keys.
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

    order_group_items:
      "company_id,group_legacy_id,order_legacy_id",

    delivery_route_items:
      "company_id,route_legacy_id,order_legacy_id"
  });

  const SUPPORTED_RESOURCES = new Set([
    "clients",
    "products",
    "services",
    "employees",
    ...TRANSACTION_RESOURCES
  ]);

  let client = null;

  function config() {
    return window.GV_SUPABASE_CONFIG || {};
  }

  function isConfigured() {
    const cfg = config();

    return (
      typeof window.supabase !== "undefined" &&
      typeof window.supabase.createClient === "function" &&
      typeof cfg.url === "string" &&
      cfg.url.trim() !== "" &&
      typeof cfg.publishableKey === "string" &&
      cfg.publishableKey.trim() !== ""
    );
  }

  function getClient() {
    if (client) {
      return client;
    }

    if (!isConfigured()) {
      return null;
    }

    const authClient =
      window.GVAuth?.getClient?.();

    if (!authClient) {
      return null;
    }

    client = authClient;
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

    if (
      !window.GVAuth?.requireManagerSession
    ) {
      throw new Error(
        "GotaVita authentication layer is unavailable."
      );
    }

    const result =
      await window.GVAuth.requireManagerSession();

    if (!result?.authenticated) {
      throw new Error(
        "Manager authentication is required for cloud data access."
      );
    }

    if (!result?.session?.user?.id) {
      throw new Error(
        "Authenticated manager session is missing a user ID."
      );
    }

    if (!result?.profile?.company_id) {
      throw new Error(
        "Authenticated manager is not assigned to a GotaVita company."
      );
    }

    client =
      window.GVAuth.getClient?.() ||
      client;

    if (!client) {
      throw new Error(
        "Authenticated Supabase client is unavailable."
      );
    }

    return result;
  }

  function assertResource(resource) {
    const name =
      String(resource || "").trim();

    if (!SUPPORTED_RESOURCES.has(name)) {
      throw new Error(
        `Unsupported Supabase resource: ${name}`
      );
    }

    return name;
  }

  function assertRows(rows) {
    const payload =
      Array.isArray(rows)
        ? rows
        : [rows];

    if (!payload.length) {
      return [];
    }

    for (const row of payload) {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row)
      ) {
        throw new Error(
          "Supabase gateway rows must be objects."
        );
      }
    }

    return payload;
  }

  function normalizeLegacyId(value) {
    const id =
      String(value ?? "").trim();

    if (!id) {
      throw new Error(
        "A stable GotaVita legacy ID is required."
      );
    }

    return id;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uuid() {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID ===
        "function"
    ) {
      return crypto.randomUUID();
    }

    throw new Error(
      "Secure UUID generation is unavailable in this browser."
    );
  }

  function json(value) {
    if (
      value &&
      typeof value === "object"
    ) {
      return value;
    }

    return {};
  }

  function num(value, fallback = 0) {
    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : fallback;
  }

  function bool(value, fallback = false) {
    if (value === undefined || value === null) {
      return fallback;
    }

    return Boolean(value);
  }

  function localDateValue(value) {
    if (!value) {
      return null;
    }

    const date =
      new Date(value);

    return Number.isNaN(
      date.getTime()
    )
      ? null
      : date.toISOString();
  }

  function localDateOnly(value) {
    if (!value) {
      return null;
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return null;
    }

    return date
      .toISOString()
      .slice(0, 10);
  }

  function mergePayload(
    original,
    payload
  ) {
    return {
      ...(payload || {}),
      ...(
        original &&
        typeof original === "object"
          ? original
          : {}
      )
    };
  }

  /*
   * ----------------------------------------------------------
   * LOCAL -> SUPABASE
   * ----------------------------------------------------------
   */

  function toSupabaseClient(row, companyId) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      name:
        String(
          row.name || ""
        ).trim(),

      client_group:
        String(
          row.group ||
          row.clientGroup ||
          ""
        ).trim() || null,

      phone:
        String(
          row.phone || ""
        ).trim() || null,

      address:
        String(
          row.address || ""
        ).trim() || null,

      default_price:
        num(
          row.defaultPrice ??
          row.price,
          0
        ),

      notes:
        String(
          row.notes || ""
        ).trim() || null,

      active:
        row.active !== false,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseProduct(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      name:
        String(
          row.name || ""
        ).trim(),

      category:
        String(
          row.category || ""
        ).trim() || null,

      current_price:
        num(
          row.price ??
          row.currentPrice,
          0
        ),

      active:
        row.active !== false,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseEmployee(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      name:
        String(
          row.name || ""
        ).trim(),

      position:
        String(
          row.position || ""
        ).trim() || null,

      salary_type:
        String(
          row.salaryType || ""
        ).trim() || null,

      salary_rate:
        num(
          row.salaryRate,
          0
        ),

      schedule:
        json(
          row.schedule
        ),

      status:
        String(
          row.status ||
          "Active"
        ).trim(),

      phone:
        String(
          row.phone || ""
        ).trim() || null,

      notes:
        String(
          row.notes || ""
        ).trim() || null,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseOrder(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      order_number:
        String(
          row.orderNumber ??
          ""
        ).trim() || null,

      client_legacy_id:
        row.clientId == null
          ? null
          : String(
              row.clientId
            ).trim(),

      product_legacy_id:
        row.productId == null
          ? null
          : String(
              row.productId
            ).trim(),

      order_date:
        localDateValue(
          row.date ??
          row.orderDate ??
          row.createdAt
        ),

      status:
        String(
          row.status ||
          "Unpaid"
        ).trim(),

      delivery_status:
        String(
          row.deliveryStatus ||
          ""
        ).trim() || null,

      gallons:
        num(
          row.gallons,
          0
        ),

      empty_gallons_collected:
        num(
          row.emptyGallonsCollected,
          0
        ),

      unit_price:
        num(
          row.price ??
          row.unitPrice,
          0
        ),

      total:
        num(
          row.total,
          0
        ),

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabasePayment(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      order_legacy_id:
        row.orderId == null
          ? (
              row.orderLegacyId ==
              null
                ? null
                : String(
                    row.orderLegacyId
                  ).trim()
            )
          : String(
              row.orderId
            ).trim(),

      amount:
        num(
          row.amount,
          0
        ),

      payment_status:
        String(
          row.paymentStatus ||
          row.status ||
          ""
        ).trim() || null,

      payment_method:
        String(
          row.paymentMethod ||
          ""
        ).trim() || null,

      paid_at:
        localDateValue(
          row.paidAt ??
          row.date
        ),

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseExpense(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      expense_date:
        localDateValue(
          row.date ??
          row.expenseDate ??
          row.createdAt
        ),

      category:
        String(
          row.category || ""
        ).trim() || null,

      description:
        String(
          row.description || ""
        ).trim() || null,

      amount:
        num(
          row.amount,
          0
        ),

      employee_legacy_id:
        row.employeeId == null
          ? null
          : String(
              row.employeeId
            ).trim(),

      is_advance:
        bool(
          row.isAdvance,
          false
        ),

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabasePayroll(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    const gross =
      num(
        row.grossPay ??
        row.gross_pay,
        0
      );

    const deductions =
      num(
        row.deductions,
        0
      );

    const net =
      num(
        row.netPay ??
        row.net_pay,
        gross - deductions
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      employee_legacy_id:
        row.employeeId == null
          ? null
          : String(
              row.employeeId
            ).trim(),

      pay_period_start:
        localDateOnly(
          row.payPeriodStart
        ),

      pay_period_end:
        localDateOnly(
          row.payPeriodEnd
        ),

      gross_pay:
        gross,

      deductions:
        deductions,

      net_pay:
        net,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseOrderGroup(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      name:
        String(
          row.name || ""
        ).trim(),

      group_date:
        localDateOnly(
          row.date ??
          row.groupDate
        ),

      status:
        String(
          row.status ||
          ""
        ).trim() || null,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseDeliveryRoute(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      name:
        String(
          row.name || ""
        ).trim() || null,

      route_date:
        localDateOnly(
          row.date ??
          row.routeDate
        ),

      status:
        String(
          row.status ||
          ""
        ).trim() || null,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseOrderGroupItem(
    row,
    companyId
  ) {
    const groupId =
      normalizeLegacyId(
        row.groupLegacyId ??
        row.groupId
      );

    const orderId =
      normalizeLegacyId(
        row.orderLegacyId ??
        row.orderId
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      group_legacy_id:
        groupId,

      order_legacy_id:
        orderId,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso()
    };
  }

  function toSupabaseDeliveryRouteItem(
    row,
    companyId
  ) {
    const routeId =
      normalizeLegacyId(
        row.routeLegacyId ??
        row.routeId
      );

    const orderId =
      normalizeLegacyId(
        row.orderLegacyId ??
        row.orderId
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      route_legacy_id:
        routeId,

      order_legacy_id:
        orderId,

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso()
    };
  }

  function toSupabaseDailyReport(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      report_date:
        localDateOnly(
          row.date ??
          row.reportDate
        ),

      note:
        String(
          row.note || ""
        ).trim() || null,

      payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseDeletedOrder(
    row,
    companyId
  ) {
    const legacyId =
      normalizeLegacyId(
        row.id
      );

    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      legacy_id:
        legacyId,

      archived_at:
        localDateValue(
          row.archivedAt ??
          row.createdAt
        ),

      legacy_payload:
        json(row),

      created_at:
        localDateValue(
          row.createdAt
        ) || nowIso(),

      updated_at:
        localDateValue(
          row.updatedAt
        ) || nowIso()
    };
  }

  function toSupabaseAuditLog(
    row,
    companyId,
    actorUserId
  ) {
    return {
      id:
        looksLikeUuid(
          row.supabaseId
        )
          ? row.supabaseId
          : uuid(),

      company_id:
        companyId,

      action:
        String(
          row.action ||
          "activity"
        ).trim(),

      entity:
        String(
          row.entity ||
          ""
        ).trim() || null,

      entity_legacy_id:
        row.entityId == null
          ? null
          : String(
              row.entityId
            ).trim(),

      actor_user_id:
        looksLikeUuid(
          actorUserId
        )
          ? actorUserId
          : null,

      details:
        json(
          row.details
        ),

      created_at:
        localDateValue(
          row.timestamp ??
          row.createdAt
        ) || nowIso()
    };
  }

  function looksLikeUuid(value) {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      )
    );
  }

  function toSupabaseRow(
    resource,
    row,
    companyId,
    actorUserId
  ) {
    switch (resource) {
      case "clients":
        return toSupabaseClient(
          row,
          companyId
        );

      case "products":
        return toSupabaseProduct(
          row,
          companyId
        );

      case "employees":
        return toSupabaseEmployee(
          row,
          companyId
        );

      case "orders":
        return toSupabaseOrder(
          row,
          companyId
        );

      case "payments":
        return toSupabasePayment(
          row,
          companyId
        );

      case "expenses":
        return toSupabaseExpense(
          row,
          companyId
        );

      case "payroll_records":
        return toSupabasePayroll(
          row,
          companyId
        );

      case "order_groups":
        return toSupabaseOrderGroup(
          row,
          companyId
        );

      case "order_group_items":
        return toSupabaseOrderGroupItem(
          row,
          companyId
        );

      case "delivery_routes":
        return toSupabaseDeliveryRoute(
          row,
          companyId
        );

      case "delivery_route_items":
        return toSupabaseDeliveryRouteItem(
          row,
          companyId
        );

      case "daily_reports":
        return toSupabaseDailyReport(
          row,
          companyId
        );

      case "deleted_orders":
        return toSupabaseDeletedOrder(
          row,
          companyId
        );

      case "audit_logs":
        return toSupabaseAuditLog(
          row,
          companyId,
          actorUserId
        );

      default:
        throw new Error(
          `No Supabase adapter exists for resource: ${resource}`
        );
    }
  }

  /*
   * ----------------------------------------------------------
   * SUPABASE -> LOCAL
   * ----------------------------------------------------------
   */

  function fromSupabaseClient(row) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        name:
          row.name,

        group:
          row.client_group ||
          "",

        phone:
          row.phone || "",

        address:
          row.address || "",

        defaultPrice:
          num(
            row.default_price,
            0
          ),

        notes:
          row.notes || "",

        active:
          row.active !== false,

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseProduct(row) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        name:
          row.name,

        category:
          row.category || "",

        price:
          num(
            row.current_price,
            0
          ),

        active:
          row.active !== false,

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseEmployee(row) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        name:
          row.name,

        position:
          row.position || "",

        salaryType:
          row.salary_type || "",

        salaryRate:
          num(
            row.salary_rate,
            0
          ),

        schedule:
          json(
            row.schedule
          ),

        status:
          row.status ||
          "Active",

        phone:
          row.phone || "",

        notes:
          row.notes || "",

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseOrder(row) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        orderNumber:
          row.order_number,

        clientId:
          row.client_legacy_id,

        productId:
          row.product_legacy_id,

        date:
          row.order_date,

        status:
          row.status,

        deliveryStatus:
          row.delivery_status,

        gallons:
          num(
            row.gallons,
            0
          ),

        emptyGallonsCollected:
          num(
            row.empty_gallons_collected,
            0
          ),

        price:
          num(
            row.unit_price,
            0
          ),

        total:
          num(
            row.total,
            0
          ),

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabasePayment(row) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        orderId:
          row.order_legacy_id,

        amount:
          num(
            row.amount,
            0
          ),

        paymentStatus:
          row.payment_status,

        paymentMethod:
          row.payment_method,

        paidAt:
          row.paid_at,

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseExpense(row) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        date:
          row.expense_date,

        category:
          row.category || "",

        description:
          row.description || "",

        amount:
          num(
            row.amount,
            0
          ),

        employeeId:
          row.employee_legacy_id,

        isAdvance:
          Boolean(
            row.is_advance
          ),

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabasePayroll(
    row
  ) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        employeeId:
          row.employee_legacy_id,

        payPeriodStart:
          row.pay_period_start,

        payPeriodEnd:
          row.pay_period_end,

        grossPay:
          num(
            row.gross_pay,
            0
          ),

        deductions:
          num(
            row.deductions,
            0
          ),

        netPay:
          num(
            row.net_pay,
            0
          ),

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseOrderGroup(
    row
  ) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        name:
          row.name,

        date:
          row.group_date,

        status:
          row.status,

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseOrderGroupItem(
    row
  ) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.id,

        groupLegacyId:
          row.group_legacy_id,

        orderLegacyId:
          row.order_legacy_id,

        createdAt:
          row.created_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseDeliveryRoute(
    row
  ) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        name:
          row.name || "",

        date:
          row.route_date,

        status:
          row.status,

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseDeliveryRouteItem(
    row
  ) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.id,

        routeLegacyId:
          row.route_legacy_id,

        orderLegacyId:
          row.order_legacy_id,

        createdAt:
          row.created_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseDailyReport(
    row
  ) {
    return mergePayload(
      row.payload,
      {
        id:
          row.legacy_id,

        date:
          row.report_date,

        note:
          row.note || "",

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseDeletedOrder(
    row
  ) {
    return mergePayload(
      row.legacy_payload,
      {
        id:
          row.legacy_id,

        archivedAt:
          row.archived_at,

        createdAt:
          row.created_at,

        updatedAt:
          row.updated_at,

        supabaseId:
          row.id
      }
    );
  }

  function fromSupabaseRow(
    resource,
    row
  ) {
    switch (resource) {
      case "clients":
        return fromSupabaseClient(row);

      case "products":
        return fromSupabaseProduct(row);

      case "employees":
        return fromSupabaseEmployee(row);

      case "orders":
        return fromSupabaseOrder(row);

      case "payments":
        return fromSupabasePayment(row);

      case "expenses":
        return fromSupabaseExpense(row);

      case "payroll_records":
        return fromSupabasePayroll(row);

      case "order_groups":
        return fromSupabaseOrderGroup(row);

      case "order_group_items":
        return fromSupabaseOrderGroupItem(row);

      case "delivery_routes":
        return fromSupabaseDeliveryRoute(row);

      case "delivery_route_items":
        return fromSupabaseDeliveryRouteItem(row);

      case "daily_reports":
        return fromSupabaseDailyReport(row);

      case "deleted_orders":
        return fromSupabaseDeletedOrder(row);

      case "audit_logs":
        return mergePayload(
          row.details,
          {
            id:
              row.id,

            timestamp:
              row.created_at,

            action:
              row.action,

            entity:
              row.entity || "",

            entityId:
              row.entity_legacy_id ||
              "",

            details:
              row.details || {}
          }
        );

      default:
        return row;
    }
  }

  function toSupabaseResource(
    resource,
    rows,
    companyId,
    actorUserId
  ) {
    return assertRows(
      rows
    ).map(
      (row) =>
        toSupabaseRow(
          resource,
          row,
          companyId,
          actorUserId
        )
    );
  }

  function fromSupabaseResource(
    resource,
    rows
  ) {
    return (
      Array.isArray(rows)
        ? rows
        : []
    ).map(
      (row) =>
        fromSupabaseRow(
          resource,
          row
        )
    );
  }

  async function selectResource(
    resource,
    options = {}
  ) {
    const name =
      assertResource(
        resource
      );

    await requireAuthenticatedManager();

    const supabase =
      getClient();

    if (!supabase) {
      throw new Error(
        "Authenticated Supabase client is unavailable."
      );
    }

    let query =
      supabase
        .from(name)
        .select("*");

    if (
      options.orderBy
    ) {
      query =
        query.order(
          String(
            options.orderBy
          ),
          {
            ascending:
              options.ascending !==
              false
          }
        );
    }

    if (
      Number.isInteger(
        options.limit
      ) &&
      options.limit >
        0
    ) {
      query =
        query.limit(
          options.limit
        );
    }

    const {
      data,
      error
    } =
      await query;

    if (error) {
      throw error;
    }

    return fromSupabaseResource(
      name,
      data
    );
  }

  async function selectLocalResource(
    resource,
    rows
  ) {
    return fromSupabaseResource(
      resource,
      rows
    );
  }

  async function upsertResource(
    resource,
    rows
  ) {
    const name =
      assertResource(
        resource
      );

    const payload =
      assertRows(
        rows
      );

    if (!payload.length) {
      return [];
    }

    const auth =
      await requireAuthenticatedManager();

    const supabase =
      getClient();

    if (!supabase) {
      throw new Error(
        "Authenticated Supabase client is unavailable."
      );
    }

    const actorUserId =
      auth?.session?.user?.id ||
      null;

    const cloudRows =
      toSupabaseResource(
        name,
        payload,
        auth.profile.company_id,
        actorUserId
      );

    if (
      name ===
      "audit_logs"
    ) {
      const {
        data,
        error
      } =
        await supabase
          .from(name)
          .insert(
            cloudRows
          )
          .select("*");

      if (error) {
        throw error;
      }

      return fromSupabaseResource(
        name,
        data
      );
    }

    if (
      name ===
        "clients" ||
      name ===
        "products" ||
      name ===
        "employees"
    ) {
      const {
        data,
        error
      } =
        await supabase
          .from(name)
          .upsert(
            cloudRows,
            {
              onConflict:
                "company_id,legacy_id"
            }
          )
          .select("*");

      if (error) {
        throw error;
      }

      return fromSupabaseResource(
        name,
        data
      );
    }

    const conflictKey =
      CONFLICT_KEYS[name];

    if (!conflictKey) {
      throw new Error(
        `No Supabase conflict key configured for resource: ${name}`
      );
    }

    const {
      data,
      error
    } =
      await supabase
        .from(name)
        .upsert(
          cloudRows,
          {
            onConflict:
              conflictKey
          }
        )
        .select("*");

    if (error) {
      throw error;
    }

    return fromSupabaseResource(
      name,
      data
    );
  }

  async function insertResource(
    resource,
    rows
  ) {
    const name =
      assertResource(
        resource
      );

    const payload =
      assertRows(
        rows
      );

    if (!payload.length) {
      return [];
    }

    const auth =
      await requireAuthenticatedManager();

    const supabase =
      getClient();

    if (!supabase) {
      throw new Error(
        "Authenticated Supabase client is unavailable."
      );
    }

    const actorUserId =
      auth?.session?.user?.id ||
      null;

    const cloudRows =
      toSupabaseResource(
        name,
        payload,
        auth.profile.company_id,
        actorUserId
      );

    const {
      data,
      error
    } =
      await supabase
        .from(name)
        .insert(
          cloudRows
        )
        .select("*");

    if (error) {
      throw error;
    }

    return fromSupabaseResource(
      name,
      data
    );
  }

  async function deleteResourceByLegacyId(
  resource,
  legacyId
) {
  const name = assertResource(resource);

  await requireAuthenticatedManager();

  const deletableResources = new Set([
    "clients",
    "products",
    "employees",
    ...LEGACY_ID_RESOURCES
  ]);

  if (!deletableResources.has(name)) {
    throw new Error(
      `Resource ${name} does not support legacy_id deletion.`
    );
  }

  const id = normalizeLegacyId(legacyId);

  const supabase = getClient();

  if (!supabase) {
    throw new Error(
      "Authenticated Supabase client is unavailable."
    );
  }

  const { data, error } = await supabase
    .from(name)
    .delete()
    .eq("legacy_id", id)
    .select("*");

  if (error) {
    throw error;
  }

  return fromSupabaseResource(
    name,
    data
  );
}

  async function deleteOrderGroupItem(
    groupLegacyId,
    orderLegacyId
  ) {
    await requireAuthenticatedManager();

    const supabase =
      getClient();

    const groupId =
      normalizeLegacyId(
        groupLegacyId
      );

    const orderId =
      normalizeLegacyId(
        orderLegacyId
      );

    const {
      data,
      error
    } =
      await supabase
        .from(
          "order_group_items"
        )
        .delete()
        .eq(
          "group_legacy_id",
          groupId
        )
        .eq(
          "order_legacy_id",
          orderId
        )
        .select("*");

    if (error) {
      throw error;
    }

    return fromSupabaseResource(
      "order_group_items",
      data
    );
  }

  async function deleteDeliveryRouteItem(
    routeLegacyId,
    orderLegacyId
  ) {
    await requireAuthenticatedManager();

    const supabase =
      getClient();

    const routeId =
      normalizeLegacyId(
        routeLegacyId
      );

    const orderId =
      normalizeLegacyId(
        orderLegacyId
      );

    const {
      data,
      error
    } =
      await supabase
        .from(
          "delivery_route_items"
        )
        .delete()
        .eq(
          "route_legacy_id",
          routeId
        )
        .eq(
          "order_legacy_id",
          orderId
        )
        .select("*");

    if (error) {
      throw error;
    }

    return fromSupabaseResource(
      "delivery_route_items",
      data
    );
  }

  async function insertAuditLog(
    entry
  ) {
    const row =
      entry &&
      typeof entry ===
        "object"
        ? entry
        : {};

    return upsertResource(
      "audit_logs",
      row
    );
  }

  async function health() {
    if (!isConfigured()) {
      return {
        ok: true,
        mode: "local",
        configured: false,
        authenticated: false,
        companyId: null
      };
    }

    try {
      const auth =
        await requireAuthenticatedManager();

      return {
        ok: true,
        mode: "supabase",
        configured: true,
        authenticated:
          !!auth?.authenticated,
        companyId:
          auth?.profile?.company_id ||
          null
      };
    } catch (error) {
      return {
        ok: false,
        mode: "supabase",
        configured: true,
        authenticated: false,
        companyId: null,
        error:
          String(
            error?.message ||
            error
          )
      };
    }
  }

  function getState() {
    return typeof window.state !==
      "undefined"
      ? window.state
      : null;
  }

  function persist() {
    if (
      typeof window.persistState ===
      "function"
    ) {
      return window.persistState();
    }

    return false;
  }

  async function loadServer() {
    if (!isConfigured()) {
      return false;
    }

    return true;
  }

  async function sync() {
    if (!isConfigured()) {
      return {
        ok: false,
        mode: "local",
        status: "local-only"
      };
    }

    try {
      const auth =
        await requireAuthenticatedManager();

      return {
        ok: true,
        mode: "supabase",
        status: "gateway-ready",
        companyId:
          auth?.profile?.company_id ||
          null
      };
    } catch (error) {
      return {
        ok: false,
        mode: "supabase",
        status:
          "authentication-required",
        error:
          String(
            error?.message ||
            error
          )
      };
    }
  }

  function backupList() {
    if (
      typeof window.readAutoBackupList ===
      "function"
    ) {
      return window.readAutoBackupList();
    }

    return [];
  }

  window.GVData =
    Object.freeze({
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
      selectLocalResource,

      upsertResource,
      insertResource,

      deleteResourceByLegacyId,
      deleteOrderGroupItem,
      deleteDeliveryRouteItem,

      insertAuditLog,

      toSupabaseRow,
      fromSupabaseRow,

      transactionResources:
        () =>
          [
            ...TRANSACTION_RESOURCES
          ],

      supportedResources:
        () =>
          [
            ...SUPPORTED_RESOURCES
          ],

      conflictKeys:
        () => ({
          ...CONFLICT_KEYS
        })
    });
})();