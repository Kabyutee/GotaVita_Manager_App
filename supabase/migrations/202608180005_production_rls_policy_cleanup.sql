/*
 * GotaVita Manager
 * Phase 5 Sprint 6 — Step 11E
 * Production RLS Policy Cleanup
 */

BEGIN;

-- ============================================================
-- 1. Enable RLS
-- ============================================================

ALTER TABLE IF EXISTS public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payroll_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.order_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.deleted_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.order_group_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_route_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Remove existing policies on transaction tables
-- ============================================================

DO $$
DECLARE
  t text;
  policy_record record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders',
    'payments',
    'expenses',
    'payroll_records',
    'order_groups',
    'delivery_routes',
    'daily_reports',
    'deleted_orders',
    'order_group_items',
    'delivery_route_items',
    'audit_logs'
  ]
  LOOP
    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_record.policyname,
        t
      );
    END LOOP;
  END LOOP;
END
$$;

-- ============================================================
-- 3. Company-isolated authenticated access
-- ============================================================
--
-- company_id is UUID in the database.
-- auth.jwt() ->> 'company_id' returns text.
-- Therefore the JWT value is explicitly cast to UUID.
-- ============================================================

CREATE POLICY orders_manager_access
ON public.orders
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY payments_manager_access
ON public.payments
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY expenses_manager_access
ON public.expenses
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY payroll_records_manager_access
ON public.payroll_records
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY order_groups_manager_access
ON public.order_groups
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY delivery_routes_manager_access
ON public.delivery_routes
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY daily_reports_manager_access
ON public.daily_reports
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY deleted_orders_manager_access
ON public.deleted_orders
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY order_group_items_manager_access
ON public.order_group_items
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY delivery_route_items_manager_access
ON public.delivery_route_items
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

CREATE POLICY audit_logs_manager_access
ON public.audit_logs
FOR ALL
TO authenticated
USING (
  company_id = (auth.jwt() ->> 'company_id')::uuid
)
WITH CHECK (
  company_id = (auth.jwt() ->> 'company_id')::uuid
);

COMMIT;