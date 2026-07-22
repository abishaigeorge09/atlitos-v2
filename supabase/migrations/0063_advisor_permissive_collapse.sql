-- 0063_advisor_permissive_collapse.sql
-- AT-141: multiple_permissive_policies burn-down (43 WARN -> 21).
--
-- Postgres combines PERMISSIVE policies with OR. When a table has several
-- permissive SELECT policies for the SAME role set, they can be merged into
-- ONE policy whose USING is the OR of the parts. That is an exact identity
-- for the access set (union is preserved), and it removes the lint.
--
-- SAFETY (the CLAUDE.md permissive-OR bug class): this migration ONLY merges
-- policies whose role set is EXACTLY {authenticated}. It never merges a
-- public/guest policy (role set {anon,authenticated}) into an owner policy,
-- because that would fold an owner disjunct (owner_id = auth.uid()) into the
-- anon-reachable expression and could widen the guest access set. The 21
-- tables that carry a public SELECT policy or a FOR ALL write policy are
-- therefore LEFT AS-IS and dispositioned in RLS.md; collapsing them cannot be
-- done without a cross-role-set merge that risks widening anon. Only the 22
-- tables below, whose authenticated-applicable SELECT policies are all
-- role={authenticated} pure-SELECT with no anon policy and no FOR ALL policy,
-- are collapsed here.
--
-- The merge is computed from the live catalog so the applied SQL and this file
-- are byte-identical (no hand-transcription of a rewritten policy body). Each
-- table's merged USING is string_agg('('||pg_get_expr(polqual)||')',' or ')
-- over precisely its {authenticated} permissive SELECT policies.
--
-- Tables collapsed (22):
--   athlete_sports, coach_certificates, coach_profiles, court_bookings,
--   donations, ledger_entries, order_feedback, order_items, order_timeline,
--   orders, payment_intents, payout_accounts, refunds, reports, sessions,
--   support_tickets, transfers, upa_evidence, user_roles, users, venue_staff,
--   verification_requests

do $mig$
declare
  authoid oid := (select oid from pg_roles where rolname = 'authenticated');
  tbls text[] := array[
    'athlete_sports','coach_certificates','coach_profiles','court_bookings',
    'donations','ledger_entries','order_feedback','order_items','order_timeline',
    'orders','payment_intents','payout_accounts','refunds','reports','sessions',
    'support_tickets','transfers','upa_evidence','user_roles','users',
    'venue_staff','verification_requests'];
  t text;
  merged text;
  n_before int;
  n_after int;
  r record;
begin
  foreach t in array tbls loop
    -- Build the OR of every {authenticated}-only permissive SELECT policy.
    select count(*),
           string_agg('(' || pg_get_expr(polqual, polrelid) || ')', ' or ')
      into n_before, merged
      from pg_policy
     where polrelid = ('public.' || t)::regclass
       and polcmd = 'r' and polpermissive
       and polroles = array[authoid];

    if n_before < 2 then
      raise exception 'AT-141 guard: table % has % authenticated permissive SELECT policies, expected >= 2', t, n_before;
    end if;

    -- Drop exactly those policies.
    for r in
      select polname from pg_policy
       where polrelid = ('public.' || t)::regclass
         and polcmd = 'r' and polpermissive
         and polroles = array[authoid]
    loop
      execute format('drop policy %I on public.%s', r.polname, t);
    end loop;

    -- Recreate as one permissive SELECT policy, same role set, OR of the parts.
    execute format(
      'create policy %I on public.%s for select to authenticated using (%s)',
      t || '_select_merged', t, merged);

    -- Post-condition: exactly one authenticated permissive SELECT policy remains.
    select count(*) into n_after
      from pg_policy
     where polrelid = ('public.' || t)::regclass
       and polcmd = 'r' and polpermissive
       and polroles = array[authoid];
    if n_after <> 1 then
      raise exception 'AT-141 guard: table % ended with % authenticated permissive SELECT policies, expected 1', t, n_after;
    end if;
  end loop;
end
$mig$;
