-- ATLITOS v2 — 0037_commerce_advisor_fixes.sql
-- Domain: commerce. Epic P4, stories AT-67 and AT-70 (advisor follow up).
--
-- The security advisor was run after 0031 through 0036 and diffed against the
-- P3 baseline, per PHASE-4-STATUS.md gate clause 7. This migration closes the
-- two findings in that diff that were UNINTENDED. The rest of the delta is
-- deliberate and is recorded in RLS.md rather than "fixed":
--
--   security_definer_view on `product_variant_availability` (ERROR)
--     Intentional, and the alternative is a silent oversell. See 0033's
--     header. It joins `public_profiles` and `coach_profiles_public`, which
--     carry the same lint for the same reason, so the pattern is not new.
--
--   rls_enabled_no_policy on `stock_reservations` (INFO)
--     Intentional. The table is service_role only, and its grants are revoked
--     from anon and authenticated outright, so "no policy" is the fail-closed
--     end state and not an oversight. `webhook_events` has carried the same
--     INFO since 0010 for the same reason.
--
--   *_security_definer_function_executable on add_to_cart, update_cart_item,
--   toggle_product_wishlist and variant_available_stock (WARN)
--     Intentional. These are the client-facing commerce RPCs; being callable
--     over /rest/v1/rpc is the entire point, and each re-checks caller
--     identity through auth.uid() internally. This matches the 29 pre-existing
--     warnings the same pattern already produces across courts and coaching.
--
-- ============================================================================
-- FIX 1. block_delete_address_in_use() was callable as an RPC.
--
-- It is a TRIGGER function, and it was never meant to be reachable over
-- PostgREST. Supabase's default grants made it so anyway. Calling it directly
-- cannot corrupt anything (a trigger function invoked outside a trigger raises
-- immediately, and it has no arguments to aim at a row), but an unreachable
-- SECURITY DEFINER entry point is exactly the sort of thing that becomes a
-- real hole after someone later gives it parameters. Withdraw it now.
-- ============================================================================

revoke all on function public.block_delete_address_in_use() from public;
revoke execute on function public.block_delete_address_in_use() from anon, authenticated;

-- ============================================================================
-- FIX 2. stock_reservation_ttl() had a mutable search_path.
--
-- Every other function this phase shipped pins `set search_path = public`;
-- this one was missed because it touches no table and looked like a bare
-- constant. The advisor is right that the exemption is not worth reasoning
-- about case by case, so it gets pinned like the rest.
-- ============================================================================

create or replace function public.stock_reservation_ttl()
returns interval
language sql
immutable
set search_path = public
as $$
  select interval '15 minutes';
$$;
