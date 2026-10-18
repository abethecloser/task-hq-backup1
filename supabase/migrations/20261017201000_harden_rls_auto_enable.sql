-- rls_auto_enable() backs the ensure_rls event trigger (runs as its owner); clients never need to call it.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
