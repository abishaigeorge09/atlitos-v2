# Real money moved: the P3 cycle-1 rejection answered

The cycle-1 approver rejected P3 because "almost none of the money actually
moved": zero session-domain ledger entries, an empty `refunds` table, and the
only session that reached `rated` had never been paid. Its punch list items 1
and 2 are closed here, with two real Razorpay test-mode payments the founder
made through the NATIVE checkout sheet on the iOS simulator.

## Session A, the full paid lifecycle

Booked via `book-session` for today 11:00 (a slot already in the past, so
`complete-session`'s server-side "only after the end time" check could pass
honestly rather than being worked around). Paid natively, Rs 1,000 captured.

    1 accept:      -> accepted            (coach1, session_transition)
    2 complete:    outcome "accrued"      (complete-session edge function)
                   gross 1000, platform_fee 10, coach_payable 990
    3 rate:        -> rated, rating 5     (player, rate_session)
    4 rate again:  REJECTED ALREADY_RATED

This is the first session earnings accrual in the project's history. Note step
2 went through the edge function, not `session_transition('complete')`, which
AT-61 now refuses precisely so the accrual cannot be skipped.

## Session B, FR-35's automatic refund

Booked for 2026-07-22 15:00, paid natively, Rs 1,000 captured, then cancelled
while still `requested`.

    cancel+refund: 200 {status: cancelled, refund_status: processed,
                        refund_amount: 1000, outcome: cancelled_and_refunded}
    repeat:        200 {refund_status: not_applicable}   <- idempotent

`refunds` now holds one row: `processed`, 1000.00, with a real
`razorpay_refund_id`. This is the first refund FR-35 has ever issued.

## Ledger, verified by SQL

| group | legs | detail | balances |
| --- | --- | --- | --- |
| 3ef7ac3f earnings | 3 | platform debit 1000, coach credit 990, platform fee credit 10 | 1000 = 1000 |
| f627e3fd refund | 2 | platform debit 1000, user credit 1000 | 1000 = 1000 |

## The balance is no longer vacuous

`get_coach_wallet_balance()` as coach1: balance 990, lifetime_earned 990,
lifetime_transferred 0, this_month 990. `get_my_transactions()` returns one
`earning` of 990. Before this run those figures were derived from an empty set,
which is what the approver meant by "correct" being vacuously true.

## Method note

The two payments required the native Razorpay sheet, which cannot be driven
without a tap, so a temporary probe screen (holding no credentials, orders
created outside the app) was mounted at the entry route, the founder tapped
through both, and the probe was deleted and the route restored immediately
after. Everything above the payment step is server state verified by SQL.
