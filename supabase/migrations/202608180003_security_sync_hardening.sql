-- GotaVita Phase 5 Sprint 4: security/sync hardening foundation
-- Assumes public.profiles contains id=auth.users.id and company_id.
-- RLS helper: authenticated user can only access their own company data.
-- The profile row is the link between auth.users and the GotaVita company.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null default 'manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_company_id_idx on public.profiles(company_id);
alter table public.profiles enable row level security;
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid());

create or replace function public.gv_current_company_id()
returns uuid language sql stable security definer set search_path=public as $$
  select company_id from public.profiles where id = auth.uid()
$$;

-- Master-data tables. Only apply the policy to tables that actually exist in this
-- release so the migration remains safe across the incremental schema history.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['company_settings','clients','employees','products','services','inventory'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('alter table public.%I enable row level security', t);
      EXECUTE format('drop policy if exists gv_company_scope on public.%I', t);
      EXECUTE format('create policy gv_company_scope on public.%I for all to authenticated using (company_id = public.gv_current_company_id()) with check (company_id = public.gv_current_company_id())', t);
    END IF;
  END LOOP;
END $$;

-- Operational tables. The same existence guard prevents an incremental migration
-- from failing because a later/optional table is not present yet.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['orders','payments','expenses','payroll_records','order_groups','delivery_routes','daily_reports','deleted_orders','audit_logs','notifications','backup_import_records'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('alter table public.%I enable row level security', t);
      EXECUTE format('drop policy if exists %I_authenticated_all on public.%I', t, t);
      EXECUTE format('drop policy if exists gv_company_scope on public.%I', t);
      EXECUTE format('create policy gv_company_scope on public.%I for all to authenticated using (company_id = public.gv_current_company_id()) with check (company_id = public.gv_current_company_id())', t);
    END IF;
  END LOOP;
END $$;

-- Child rows carry company_id directly, so they receive the same company boundary.
-- Sprint 5.5 also verifies cross-company references before production cutover.
