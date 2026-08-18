-- GotaVita Manager — Phase 5 Sprint 5.5 data-integrity hardening
-- Additive and idempotent. Protects core business records at the database boundary.

-- Returned containers can never exceed delivered containers.
alter table public.orders drop constraint if exists orders_empty_returned_valid;
alter table public.orders add constraint orders_empty_returned_valid
  check (coalesce(empty_gallons_collected,0) >= 0 and coalesce(empty_gallons_collected,0) <= coalesce(gallons,0));

-- Core order statuses are constrained to the values understood by the application.
alter table public.orders drop constraint if exists orders_status_valid;
alter table public.orders add constraint orders_status_valid
  check (status is null or status in ('Paid','Unpaid','Pending','Cancelled'));

-- Financial values must remain non-negative.
alter table public.orders drop constraint if exists orders_unit_price_nonnegative;
alter table public.orders add constraint orders_unit_price_nonnegative check (coalesce(unit_price,0) >= 0);
alter table public.payments drop constraint if exists payments_amount_nonnegative;
alter table public.payments add constraint payments_amount_nonnegative check (coalesce(amount,0) >= 0);
alter table public.payroll_records drop constraint if exists payroll_gross_nonnegative;
alter table public.payroll_records add constraint payroll_gross_nonnegative check (coalesce(gross_pay,0) >= 0);
alter table public.payroll_records drop constraint if exists payroll_deductions_nonnegative;
alter table public.payroll_records add constraint payroll_deductions_nonnegative check (coalesce(deductions,0) >= 0);
alter table public.payroll_records drop constraint if exists payroll_net_nonnegative;
alter table public.payroll_records add constraint payroll_net_nonnegative check (coalesce(net_pay,0) >= 0);

-- Prevent duplicate visible order numbers inside one company when present.
create unique index if not exists orders_company_order_number_unique_idx
  on public.orders(company_id, order_number)
  where order_number is not null and btrim(order_number) <> '';

-- Fast integrity checks for operational relationships.
create index if not exists order_group_items_company_order_idx on public.order_group_items(company_id, order_legacy_id);
create index if not exists delivery_route_items_company_order_idx on public.delivery_route_items(company_id, order_legacy_id);
create index if not exists deleted_orders_company_archived_idx on public.deleted_orders(company_id, archived_at desc);
