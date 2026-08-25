-- Keep the company-scope helper callable to authenticated/server roles only.
revoke execute on function public.gv_current_company_id() from public;
grant execute on function public.gv_current_company_id() to authenticated, service_role;

-- Avoid per-row auth.uid() evaluation in the profile self-select policy.
alter policy profiles_self_select on public.profiles
  using ((select auth.uid()) = id);
