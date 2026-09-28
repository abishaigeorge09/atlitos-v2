-- ATLITOS: pre go live payments check (0140 / 0141). READ ONLY.
--
-- NOT A MIGRATION. Run by a human against production, in the SQL editor or
-- with psql, twice: once BEFORE the cutover (after 0140 is applied, before
-- RAZORPAY_MODE=live) and once right AFTER the first Rs 1 live cycle. Every
-- statement is a SELECT inside a READ ONLY transaction that is rolled back, so
-- running it cannot change anything. Go live steps: PAYMENTS.md, "Payment mode".
--
-- Each block states what it must return. A block that returns anything else
-- STOPS the cutover until a human has reviewed the rows and written down the
-- decision (PAYMENTS.md, "Payment mode", go live guard).

begin transaction read only;

-- 1. 0140 is in place. Expect one row: data_type text, is_nullable NO.
--    column_default is 'test'::text before 0141 and NULL after it. At the
--    second run (after RAZORPAY_MODE=live) it MUST be NULL.
select data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'payment_intents'
   and column_name = 'razorpay_mode';

-- 2. Every balance read carries the mode filter. Expect ZERO rows: any row
--    here is a function whose live definition does not mention razorpay_mode,
--    meaning 0140 is not applied or was overwritten by a later migration.
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     '_ledger_eligible_balance', 'admin_payouts_due', 'get_payout_account_balance',
     'get_coach_wallet_balance', 'get_my_payout_method', 'admin_kpi_money'
   )
   and p.prosrc not like '%razorpay_mode%';

-- 3. Mode distribution. Before cutover expect only 'test' rows. After the
--    first live cycle expect exactly the Rs 1 live intent(s) you just made.
select razorpay_mode, status, count(*) as intents, sum(amount) as amount
  from public.payment_intents
 group by razorpay_mode, status
 order by razorpay_mode, status;

-- 4. THE GO LIVE GUARD: payout rows that carry no payment intent.
--    Payout debits and payout reversals are written with payment_intent_id
--    null, so they ALWAYS count toward a balance, in either mode. A payout
--    recorded against test era credits would therefore sit, after cutover, as
--    a debit against real money. Before cutover every block below must return
--    ZERO rows, or each row must be reviewed and the decision recorded.
--    (2026-09-29: transfers had 0 rows, null intent ledger rows 0.)

-- 4a. Transfers of any status. Expect zero rows before cutover.
select t.id, t.payout_account_id, t.amount, t.status, t.method,
       t.external_reference, t.created_at
  from public.transfers t
 order by t.created_at;

-- 4b. Ledger rows with no payment intent (payout legs, reversals, manual
--     adjustments). Expect zero rows before cutover.
select le.id, le.entry_group_id, le.account_type, le.account_ref, le.direction,
       le.amount, le.domain, le.entity_id, le.description, le.created_at
  from public.ledger_entries le
 where le.payment_intent_id is null
 order by le.created_at;

-- 5. What the mode filter drops: ledger money on test intents, per account
--    type. Informational. Coach and court_partner totals here are what the
--    Earnings screens and payout balances stop showing at 0140.
select le.account_type, le.direction, count(*) as legs, sum(le.amount) as amount
  from public.ledger_entries le
  join public.payment_intents pi on pi.id = le.payment_intent_id
 where pi.razorpay_mode = 'test'
 group by le.account_type, le.direction
 order by le.account_type, le.direction;

-- 6. Test era money that the refund paths will refuse with
--    REFUND_MODE_MISMATCH once the mode is live. Review and settle by hand
--    (or accept, since test money is not owed) before cutover.
-- 6a. Sessions still awaiting a coach with a captured test payment
--     (cancel-session-refund and decline-session-refund will refuse).
select s.id as session_id, s.status, s.player_id, s.coach_id, pi.id as payment_intent_id,
       pi.amount, pi.created_at
  from public.sessions s
  join public.payment_intents pi on pi.domain = 'session' and pi.entity_id = s.id
 where s.status = 'requested' and pi.status = 'captured' and pi.razorpay_mode = 'test';

-- 6b. Open orders paid in test mode (admin-order-refund will refuse).
select o.id as order_id, o.status, o.total, pi.id as payment_intent_id, pi.created_at
  from public.orders o
  join public.payment_intents pi on pi.id = o.payment_intent_id
 where o.status not in ('delivered', 'cancelled') and pi.razorpay_mode = 'test';

-- 6c. Refunds on test intents that never settled.
select r.id, r.domain, r.entity_id, r.amount, r.status, r.attempts, r.failure_reason
  from public.refunds r
  join public.payment_intents pi on pi.id = r.payment_intent_id
 where r.status <> 'processed' and pi.razorpay_mode = 'test';

-- 7. Empower (UPA) fund money on test intents. NOT filtered by 0140 (see
--    PAYMENTS.md, "Payment mode", for why): these amounts keep showing as
--    "total raised". A launch data decision, not a payments one.
select le.account_ref as upa_fund_ref, sum(case when le.direction = 'credit' then le.amount else -le.amount end) as test_balance
  from public.ledger_entries le
  join public.payment_intents pi on pi.id = le.payment_intent_id
 where le.account_type = 'upa_fund' and pi.razorpay_mode = 'test'
 group by le.account_ref
 order by test_balance desc;

rollback;
