-- JARVIS security hardening: remove anonymous Data API privileges from business tables
-- and make company scoping helper SECURITY INVOKER.

revoke all on table public.clients from anon;
revoke all on table public.products from anon;
revoke all on table public.services from anon;
revoke all on table public.employees from anon;
revoke all on table public.orders from anon;
revoke all on table public.payments from anon;
revoke all on table public.expenses from anon;
revoke all on table public.payroll_records from anon;
revoke all on table public.order_groups from anon;
revoke all on table public.delivery_routes from anon;
revoke all on table public.order_group_items from anon;
revoke all on table public.delivery_route_items from anon;
revoke all on table public.daily_reports from anon;
revoke all on table public.deleted_orders from anon;
revoke all on table public.audit_logs from anon;
revoke all on table public.profiles from anon;
revoke all on table public.companies from anon;

create or replace function public.gv_current_company_id()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

revoke execute on function public.gv_current_company_id() from public;
grant execute on function public.gv_current_company_id() to authenticated;
