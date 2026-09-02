-- JARVIS least-privilege hardening:
-- managers only need to read their own company row during authorization.
-- Do not expose the full companies table to every authenticated account.

drop policy if exists "companies_authenticated_select" on public.companies;

create policy "companies_current_company_select"
  on public.companies
  for select
  to authenticated
  using (id = public.gv_current_company_id());
