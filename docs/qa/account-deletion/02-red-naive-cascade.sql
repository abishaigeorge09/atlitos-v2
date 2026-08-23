\pset format aligned
\set ath '''11111111-1111-1111-1111-111111111111'''

\echo
\echo ############ BEFORE ############
select
  (select count(*) from public.payment_intents)                          as payment_intents,
  (select count(*) from public.ledger_entries)                           as ledger_entries,
  (select count(*) from public.ledger_entries where payment_intent_id is null) as ledger_orphaned,
  (select count(*) from public.donations)                                as donations,
  (select count(*) from public.sessions)                                 as sessions,
  (select count(*) from public.court_bookings)                           as court_bookings,
  (select count(*) from public.chat_messages)                            as chat_messages,
  (select coalesce(sum(amount) filter (where direction='debit'),0)
        - coalesce(sum(amount) filter (where direction='credit'),0)
     from public.ledger_entries)                                         as ledger_imbalance;

\echo
\echo ############ NAIVE DELETE: delete from auth.users ############
delete from auth.users where id = :ath;

\echo
\echo ############ AFTER ############
select
  (select count(*) from public.payment_intents)                          as payment_intents,
  (select count(*) from public.ledger_entries)                           as ledger_entries,
  (select count(*) from public.ledger_entries where payment_intent_id is null) as ledger_orphaned,
  (select count(*) from public.donations)                                as donations,
  (select count(*) from public.sessions)                                 as sessions,
  (select count(*) from public.court_bookings)                           as court_bookings,
  (select count(*) from public.chat_messages)                            as chat_messages,
  (select coalesce(sum(amount) filter (where direction='debit'),0)
        - coalesce(sum(amount) filter (where direction='credit'),0)
     from public.ledger_entries)                                         as ledger_imbalance;
