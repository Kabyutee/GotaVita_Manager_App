-- GotaVita Manager — Phase 5 Sprint 2 master-data foundation
-- Safe to run repeatedly. It creates only the master-data tables used by this sprint.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.companies (id, legacy_id, name)
values ('6b43b8f4-7c31-4b5c-9a9d-8f3c9c5e7a01'::uuid, 'gotavita', 'GotaVita Purified Water Refilling Station')
on conflict (legacy_id) do update set name = excluded.name, updated_at = now();

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  name text not null,
  client_group text,
  phone text,
  address text,
  default_price numeric(12,2),
  notes text,
  active boolean not null default true,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists clients_company_name_idx on public.clients(company_id, lower(name));

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  name text not null,
  category text,
  current_price numeric(12,2) not null default 0,
  active boolean not null default true,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists products_company_name_idx on public.products(company_id, lower(name));

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  name text not null,
  position text,
  salary_type text,
  salary_rate numeric(12,2) not null default 0,
  schedule jsonb not null default '{}'::jsonb,
  status text not null default 'Active',
  phone text,
  notes text,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists employees_company_name_idx on public.employees(company_id, lower(name));

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_id text not null,
  name text not null,
  category text,
  price numeric(12,2) not null default 0,
  active boolean not null default true,
  legacy_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, legacy_id)
);

create index if not exists services_company_name_idx on public.services(company_id, lower(name));

-- Sprint 2 authorization baseline: authenticated managers can work with master data.
-- Company-level policies will be tightened in the RLS hardening sprint after profiles/roles are finalized.
alter table public.companies enable row level security;
alter table public.clients enable row level security;
alter table public.products enable row level security;
alter table public.employees enable row level security;
alter table public.services enable row level security;

drop policy if exists companies_authenticated_select on public.companies;
create policy companies_authenticated_select on public.companies for select to authenticated using (true);

drop policy if exists clients_authenticated_all on public.clients;
create policy clients_authenticated_all on public.clients for all to authenticated using (true) with check (true);

drop policy if exists products_authenticated_all on public.products;
create policy products_authenticated_all on public.products for all to authenticated using (true) with check (true);

drop policy if exists employees_authenticated_all on public.employees;
create policy employees_authenticated_all on public.employees for all to authenticated using (true) with check (true);

drop policy if exists services_authenticated_all on public.services;
create policy services_authenticated_all on public.services for all to authenticated using (true) with check (true);
