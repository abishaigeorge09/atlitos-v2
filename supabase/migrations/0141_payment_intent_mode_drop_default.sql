-- ATLITOS v2 - 0141_payment_intent_mode_drop_default.sql
--
-- APPLIED AT GO LIVE, NOT WITH 0140. This is a required cutover step, not a
-- cleanup. Order (PAYMENTS.md, "Payment mode", go live steps):
--
--   1. 0140 is applied.
--   2. EVERY function that creates a payment intent is redeployed from the
--      0140 build, so each one stamps razorpay_mode itself: book-session,
--      book-court (including the walk in path), checkout, donate, join-group,
--      renew-group-membership.
--   3. THIS FILE is applied.
--   4. Only then is RAZORPAY_MODE set to live.
--
-- Why. 0140 gave payment_intents.razorpay_mode a default of 'test' so that a
-- stale function build could not fail a booking during the deploy window. Once
-- the mode is live, that same default is dangerous: a real payment created by
-- a stale build would be stamped 'test', razorpay-webhook would acknowledge
-- and ignore its capture (the intent is not the deployment's mode), and the
-- coach or venue would never be paid. Without a default, an insert that does
-- not stamp the mode fails the not null constraint and the booking fails
-- loudly at creation, before any money moves.
--
-- Check before applying (read only):
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'payment_intents'
--      and column_name = 'razorpay_mode';
-- Idempotent: dropping an absent default is a no-op.

alter table public.payment_intents
  alter column razorpay_mode drop default;

comment on column public.payment_intents.razorpay_mode is
  'Which Razorpay account the intent belongs to: test or live (0140). No default (0141): every intent creating function must stamp it. Only live intents count toward coach and venue balances. Every row before 0140 is test.';
