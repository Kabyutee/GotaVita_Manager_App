-- Explicitly remove anonymous execution from the SECURITY DEFINER helper.
revoke execute on function public.gv_current_company_id() from anon;
grant execute on function public.gv_current_company_id() to authenticated, service_role;
