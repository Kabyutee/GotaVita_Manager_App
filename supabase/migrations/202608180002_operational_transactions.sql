-- GotaVita Manager — Phase 5 Sprint 3 operational transaction foundation
-- Safe to run repeatedly. This sprint creates transaction tables and does NOT migrate/write data by itself.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  order_number text,
  client_legacy_id text,
  product_legacy_id text,
  order_date timestamptz,
  status text,
  delivery_status text,
  gallons numeric(12,2),
  empty_gallons_collected numeric(12,2) not null default 0,
  unit_price numeric(12,2),
  total numeric(12,2),
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists orders_company_date_idx on public.orders(company_id, order_date desc);
create index if not exists orders_company_client_idx on public.orders(company_id, client_legacy_id);
create index if not exists orders_company_status_idx on public.orders(company_id, status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  order_legacy_id text,
  amount numeric(12,2) not null default 0,
  payment_status text,
  payment_method text,
  paid_at timestamptz,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists payments_company_order_idx on public.payments(company_id, order_legacy_id);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  expense_date timestamptz,
  category text,
  description text,
  amount numeric(12,2) not null default 0,
  employee_legacy_id text,
  is_advance boolean not null default false,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists expenses_company_date_idx on public.expenses(company_id, expense_date desc);
create index if not exists expenses_company_employee_idx on public.expenses(company_id, employee_legacy_id);

create table if not exists public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  employee_legacy_id text,
  pay_period_start date,
  pay_period_end date,
  gross_pay numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create table if not exists public.order_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  name text not null,
  group_date date,
  status text,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create table if not exists public.order_group_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  group_legacy_id text not null,
  order_legacy_id text not null,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, group_legacy_id, order_legacy_id)
);

create table if not exists public.delivery_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  name text,
  route_date date,
  status text,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create table if not exists public.delivery_route_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_legacy_id text not null,
  order_legacy_id text not null,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, route_legacy_id, order_legacy_id)
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  report_date date,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create table if not exists public.deleted_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  archived_at timestamptz,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  action text not null,
  entity text,
  entity_legacy_id text,
  actor_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_company_created_idx on public.audit_logs(company_id, created_at desc);

-- Keep critical numeric business data sane at the database boundary.
alter table public.orders drop constraint if exists orders_total_nonnegative;
alter table public.orders add constraint orders_total_nonnegative check (coalesce(total,0) >= 0);
alter table public.orders drop constraint if exists orders_gallons_nonnegative;
alter table public.orders add constraint orders_gallons_nonnegative check (coalesce(gallons,0) >= 0);
alter table public.expenses drop constraint if exists expenses_amount_nonnegative;
alter table public.expenses add constraint expenses_amount_nonnegative check (coalesce(amount,0) >= 0);

-- RLS is enabled now; policies are deliberately scoped broadly to authenticated managers
-- until company/role policy hardening in Sprint 4.
do $$
declare t text;
begin
  foreach t in array array['orders','payments','expenses','payroll_records','order_groups','order_group_items','delivery_routes','delivery_route_items','daily_reports','deleted_orders','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy orders_authenticated_all on public.orders for all to authenticated using (true) with check (true);
create policy payments_authenticated_all on public.payments for all to authenticated using (true) with check (true);
create policy expenses_authenticated_all on public.expenses for all to authenticated using (true) with check (true);
create policy payroll_authenticated_all on public.payroll_records for all to authenticated using (true) with check (true);
create policy order_groups_authenticated_all on public.order_groups for all to authenticated using (true) with check (true);
create policy order_group_items_authenticated_all on public.order_group_items for all to authenticated using (true) with check (true);
create policy delivery_routes_authenticated_all on public.delivery_routes for all to authenticated using (true) with check (true);
create policy delivery_route_items_authenticated_all on public.delivery_route_items for all to authenticated using (true) with check (true);
create policy daily_reports_authenticated_all on public.daily_reports for all to authenticated using (true) with check (true);
create policy deleted_orders_authenticated_all on public.deleted_orders for all to authenticated using (true) with check (true);
create policy audit_logs_authenticated_all on public.audit_logs for all to authenticated using (true) with check (true);
