-- GotaVita Manager — Phase 5 Sprint 6 Step 1
-- Production RLS policy cleanup.
--
-- Sprint 2/3 intentionally created broad authenticated policies as a migration
-- foundation. Sprint 4 added gv_company_scope policies, but PostgreSQL combines
-- permissive policies with OR semantics, so the old broad policies must be
-- removed explicitly before production. This migration is safe to re-run.

-- Companies: managers may only see their own company.
drop policy if exists companies_authenticated_select on public.companies;
drop policy if exists gv_company_scope on public.companies;
create policy gv_company_scope on public.companies
  for select to authenticated
  using (id = public.gv_current_company_id());

-- Master data: remove the Sprint 2 broad policies before applying the company boundary.
drop policy if exists clients_authenticated_all on public.clients;
drop policy if exists products_authenticated_all on public.products;
drop policy if exists employees_authenticated_all on public.employees;
drop policy if exists services_authenticated_all on public.services;

do $$ declare t text; begin
  foreach t in array array['clients','products','employees','services'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop policy if exists gv_company_scope on public.%I', t);
      execute format('create policy gv_company_scope on public.%I for all to authenticated using (company_id = public.gv_current_company_id()) with check (company_id = public.gv_current_company_id())', t);
    end if;
  end loop;
end $$;

-- Operational data and child tables: remove all broad Sprint 3 policies.
drop policy if exists orders_authenticated_all on public.orders;
drop policy if exists payments_authenticated_all on public.payments;
drop policy if exists expenses_authenticated_all on public.expenses;
drop policy if exists payroll_authenticated_all on public.payroll_records;
drop policy if exists order_groups_authenticated_all on public.order_groups;
drop policy if exists order_group_items_authenticated_all on public.order_group_items;
drop policy if exists delivery_routes_authenticated_all on public.delivery_routes;
drop policy if exists delivery_route_items_authenticated_all on public.delivery_route_items;
drop policy if exists daily_reports_authenticated_all on public.daily_reports;
drop policy if exists deleted_orders_authenticated_all on public.deleted_orders;
drop policy if exists audit_logs_authenticated_all on public.audit_logs;

do $$ declare t text; begin
  foreach t in array [
    'orders','payments','expenses','payroll_records','order_groups',
    'order_group_items','delivery_routes','delivery_route_items',
    'daily_reports','deleted_orders','audit_logs'
  ] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('drop policy if exists gv_company_scope on public.%I', t);
      execute format('create policy gv_company_scope on public.%I for all to authenticated using (company_id = public.gv_current_company_id()) with check (company_id = public.gv_current_company_id())', t);
    end if;
  end loop;
end $$;
