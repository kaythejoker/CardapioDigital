-- Supabase creates this event-trigger helper in some projects. It is not an app RPC.
-- Keep platform event triggers working while removing direct client execution.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
