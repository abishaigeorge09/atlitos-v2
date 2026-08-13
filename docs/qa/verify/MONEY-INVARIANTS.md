# Money invariants, end to end

Lane: the financial invariant. All checks read-only against `syzzfgaudpifwvbpycyi`.
Tree: `integration/p6-audit-fixes` @ `4793ce4`. Date 2026-08-14.

No writes, no DDL, no device. Every claim below carries a query result or a `file:line`.

---

## Verdict

| # | Check | Result |
|---|---|---|
| 1 | Ledger balances per `entry_group_id` | PASS, and it is enforced by a constraint trigger, not just observed |
| 2 | Referential integrity, both directions, 5 domains | **FAIL. 56 orphaned captured membership payments, Rs 64,000** |
| 3 | Client-side writes to money tables | PASS. Zero. Blocked at the GRANT layer, not only by RLS |
| 4 | State machines refuse illegal transitions | PASS. No status write escapes the transition functions |
| 5 | Pending refunds | 10 pending, all synthetic. **Structurally unrecoverable, no retry path exists** |

Two blocking findings (F-1, F-2), two defense-in-depth findings (F-3, F-4), one doc correction (F-5).

---

## 1. The ledger balances

`ledger_entries` stores `amount` positive with a separate `direction` enum
(`debit`, `credit`), so `sum(amount)` is meaningless. The direction-aware check:

```sql
select entry_group_id,
       sum(case when direction = 'debit' then amount else -amount end) as net
from public.ledger_entries group by entry_group_id;
```

| Metric | Value |
|---|---|
| Total entry groups | 195 |
| Unbalanced groups | **0** |
| Worst absolute imbalance | **0.00** |
| Total entries | 532 |
| Groups with a single leg | 0 |

### This is stronger than a passing query

The balance is not a property that happens to hold, it is enforced by the database.
`pg_trigger` shows:

```
CREATE CONSTRAINT TRIGGER ledger_entries_assert_balanced
  AFTER INSERT ON public.ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_group_balanced()
```

`assert_ledger_group_balanced()` (read from `pg_proc`, not the repo) sums debits and
credits for the new row's `entry_group_id` and raises `LEDGER_UNBALANCED` if they
differ. Deferred to commit, so a multi-leg group is legal mid-transaction and illegal
at commit. That is the correct design.

**One real gap in it.** The trigger is `AFTER INSERT` only. It does not fire on UPDATE
or DELETE, so mutating or removing a leg of an already-balanced group would not be
caught. `authenticated` and `anon` hold no UPDATE or DELETE grant on `ledger_entries`
(section 3), so only the service role can reach it, but the invariant is enforced one
way rather than both.

Per-domain totals, all internally consistent (commerce platform credit 16,826 plus
upa_fund credit 16 equals platform debit 16,842):

| Domain | Platform debit | Coach/partner credit | Platform credit | Other |
|---|---|---|---|---|
| commerce | 16,842.00 | - | 16,826.00 | upa_fund 16.00 |
| court | 42,770.00 | court_partner 42,130.00 | 640.00 | - |
| donation | 11,255.18 | - | - | upa_fund 11,255.18 |
| membership | 74,000.00 | coach 73,390.00 | 610.00 | - |
| session | 14,000.00 | coach 6,930.00 | 70.00 | user 7,000.00 |

---

## 2. Referential integrity, both directions

The F-31c lesson is the point of this section: "the money tables are untouched" is the
wrong post-condition. Deleting the owning entities while preserving their payments
leaves the ledger balancing perfectly and the data still wrong. So both directions were
checked with `NOT EXISTS`, and direction A accepts either linkage form (the entity's
`payment_intent_id` back-reference **or** `payment_intents.entity_id` forward reference),
so a row is only called an orphan when neither resolves.

### Direction A: captured payments with no owning entity

```sql
select count(*) from payment_intents pi
where pi.domain = '<d>' and pi.status in ('captured','refunded')
  and not exists (select 1 from <entity> e where e.payment_intent_id = pi.id)
  and not exists (select 1 from <entity> e where e.id = pi.entity_id);
```

| Domain | Entity table | Orphaned captured intents | Amount |
|---|---|---|---|
| court | `court_bookings` | 0 | 0 |
| session | `sessions` | 0 | 0 |
| **membership** | `group_memberships` | **56** | **Rs 64,000.00** |
| commerce | `orders` | 0 | 0 |
| donation | `donations` | 0 | 0 |

### Direction B: entities pointing at a payment that does not resolve

All zero. Eleven separate checks:

```
court_bookings.pi_unresolved        0    ledger.pi_unresolved              0
sessions.pi_unresolved              0    ledger.pi_NULLED_orphan           0
group_memberships.pi_unresolved     0    refunds.pi_unresolved             0
orders.pi_unresolved                0    transfers.payout_acct_unresolved  0
donations.pi_unresolved             0    transfers.ledger_group_missing    0
                                         refunds.ledger_group_missing      0
```

Direction B is structurally protected: every one of these columns carries a real FK
(`pg_constraint`), so it cannot dangle. Direction A is the unprotected side, and it is
the side that broke.

### F-1 (P0): 56 orphaned membership payments, and phantom coach earnings

Characterisation of the 56:

| Property | Value |
|---|---|
| Orphans | 56 of 61 captured membership intents |
| `entity_id` null | 0 |
| `entity_id` set but dangling | **56** |
| Created between | 2026-07-25 and 2026-08-11 |
| Ledger groups still present | **56** |
| Coach credit for deleted memberships | **Rs 63,440.00** |
| `group_memberships` rows now | 5 |

**The mechanism, from `pg_constraint`:**

```
group_memberships_group_id_fkey          FOREIGN KEY (group_id)
    REFERENCES training_groups(id) ON DELETE CASCADE
group_memberships_payment_intent_id_fkey FOREIGN KEY (payment_intent_id)
    REFERENCES payment_intents(id) ON DELETE SET NULL
```

Deleting a `training_groups` row cascades away its `group_memberships`. The
`payment_intents` rows are on the *other* side of a `SET NULL` edge, so they survive
untouched, along with every one of their ledger legs. The 36 `training_groups` deleted
in the recorded incident took their memberships with them and left the money behind.
`entity_id` on all 56 still points at the `group_memberships` ids that no longer exist.

**The consequence is not cosmetic.** `get_coach_wallet_balance()` (read from `pg_proc`)
computes a coach's withdrawable balance straight off the ledger:

```sql
select coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0)
from public.ledger_entries le
where le.account_type = 'coach' and le.account_ref = v_uid;
```

It has no join to `group_memberships`, so the 63,440 of credits for deleted memberships
counts as spendable balance. `supabase/functions/razorpay-route-transfer/index.ts:214`
gates a withdrawal only on `if (body.amount > balance)`, so that balance is withdrawable.

Split by coach:

| Coach | Handle | Email | Phantom balance | Legs | Payout account |
|---|---|---|---|---|---|
| `883b6f5d` | democoachtwo | coach2@atlitos.dev | Rs 53,640.00 | 36 | 0 |
| `5b262cf1` | democoachone | coach1@atlitos.dev | Rs 9,800.00 | 20 | **1** |

**Severity call, stated honestly.** Both holders are demo accounts on `@atlitos.dev`,
created 2026-07-19, so no real coach can withdraw real money today. That is what keeps
this off a production-incident footing. It is still P0 for launch because the defect is
in the schema, not in the data: the same cascade on a real group produces a real
withdrawable phantom balance, and the ledger keeps balancing while it happens. This is
exactly the shape the ledger check cannot see.

**Fix direction (not applied, DB write gate).** Either make the membership money edge
`ON DELETE RESTRICT` so a paid group cannot be deleted out from under its payments (the
pattern `sessions_group_id_fkey` and `donations_payment_intent_id_fkey` already use), or
make `get_coach_wallet_balance` require a resolvable owning entity. The first is better:
it fixes the cause rather than one reader of the symptom. Six other readers of
`ledger_entries` would each need the second fix.

---

## 3. Client-side writes to money-bearing tables

**Result: zero violations.** The invariant holds, and it holds at a stronger layer than
the code.

### The real enforcement is the GRANT, not RLS

`information_schema.role_table_grants` for `anon` and `authenticated`:

| Table | anon | authenticated |
|---|---|---|
| `payment_intents` | SELECT | SELECT |
| `ledger_entries` | SELECT | SELECT |
| `payout_accounts` | SELECT | SELECT |
| `transfers` | SELECT | SELECT |
| `refunds` | (none) | **SELECT only** |
| `orders` | SELECT | SELECT |
| `sessions` | SELECT | SELECT |
| `court_bookings` | SELECT | SELECT |
| `group_memberships` | SELECT | SELECT |
| `donations` | (none) | SELECT |

(REFERENCES/TRIGGER/TRUNCATE also present, see F-3.)

No INSERT, UPDATE or DELETE on any money table for either client role. A client write is
refused before RLS is consulted. RLS then scopes reads on top:
`payment_intents_select_merged` is `has_role('admin') OR user_id = auth.uid()`,
`ledger_entries_select_merged` scopes by `account_ref`, `transfers_select_merged` joins
through `payout_accounts` to `venues.partner_user_id`.

### Code sweep

Every `.from("<money table>")` site in `apps/` and `packages/` was checked for a write
within the following 8 lines. 86 such sites exist. Four writes were found, all four in
the e2e suite and all four **negative tests that prove the refusal**, which is the
correct shape per the house rule:

- `apps/e2e/specs/money/admin.spec.ts:254` AD-07, admin JWT attempts
  `orders.update({status:"delivered"})`, asserts zero rows affected.
- `apps/e2e/specs/money/courts.spec.ts:173` player JWT attempts
  `court_bookings.update({status:"confirmed"})`, asserts zero rows affected **and then
  re-reads with the service client to confirm the status is still `pending_payment`**.
  That read-back is what makes it a real proof rather than a vacuous pass.
- `apps/e2e/specs/money/shop.spec.ts:215` and `admin.spec.ts:251` are reads.

Zero writes in `apps/mobile`, `apps/admin`, `apps/portal-*`, or `packages/api`.

**The indirect path was checked too, not assumed away.** `apps/admin` registers
`dataProvider(supabaseClient)` from `@refinedev/supabase` at `apps/admin/src/App.tsx:51`
with `orders`, `court_bookings` and `fee_config` among its resources, which is a write
capability my table-name grep cannot see. Refine writes through `useUpdate` / `useCreate`
/ `useDelete` / `useForm`; none of those appear anywhere in `apps/admin/src`. The admin
mutates through edge functions instead: `advanceOrder` and `refundOrder` at
`apps/admin/src/pages/orders/show.tsx:139` and `:166`.

Note the docblock at `apps/admin/src/pages/orders/show.tsx:44` asserting "There is no
`.update()` against orders anywhere in this bundle." That claim is true, but it was
verified against the grants and the Refine surface rather than taken on trust.

### Server-side price revalidation

`PRICE_MISMATCH` is raised in all five checkout paths that display a bill to the client:
`checkout:403`, `book-session:345`, `join-group:155`, `renew-group-membership:147`,
`donate:190`. Each recomputes the bill server side and compares the client's figure.

`book-court` has no `PRICE_MISMATCH` branch. **Checked rather than assumed, because a
client-supplied price is exactly what the invariant forbids.**
`supabase/functions/book-court/index.ts:294` reads
`round2(body.price_override ?? matchedSlot.price)`, a client-supplied number used as the
subtotal. It is correctly gated:

- `price_override` is only parsed inside `if (booking_source === "walk_in")` (`:163`,
  `:177`), so a self-service athlete request cannot carry one at all.
- The walk-in path calls `assertCourtPartnerOrStaff` at `:267`, which throws `FORBIDDEN`
  unless the caller owns the venue or holds a `venue_staff` row, **before** the subtotal
  is computed at `:294`.
- `price_override_reason` is mandatory and both are written to `audit_log`.

This is a venue partner setting the price on their own court for a walk-in, PRD-03 FR-17.
Not a violation.

---

## 4. State machines

### Legal edges, read from `pg_proc` on the live database

**`sessions`** via `session_transition_internal`:

| Action | From | To |
|---|---|---|
| accept | requested | accepted |
| decline | requested | declined |
| start | accepted | in_progress |
| complete | accepted, in_progress | completed |
| cancel | requested | cancelled |
| cancel | accepted | cancelled |
| reschedule | accepted | rescheduled |
| rate | completed | rated (via `rate_session`) |

Every other edge raises `INVALID_TRANSITION: session % is not <state>`.

**`court_bookings`** via `court_booking_transition`: cancel to `cancelled` or `no_show`,
no_show to `no_show`, complete to `completed`, reschedule to `rescheduled`, each guarded
by `INVALID_TRANSITION: court_booking % is not confirmed`. Unknown action raises
`INVALID_TRANSITION: unknown action %`.

**`orders`** via `order_transition`, an explicit allow-list:

```
placed     -> shipped, cancelled
shipped    -> in_transit
in_transit -> delivered
delivered  -> (terminal)
cancelled  -> (terminal)
```

### Nothing sets a status outside these functions

Enumerated every plpgsql/sql function in `public` whose body contains both `set status =`
and an `update` against a money table (`prokind='f'`, joined to `pg_language` to exclude
aggregates and C functions). Complete list, with client EXECUTE grants:

| Function | Callable by anon/authenticated |
|---|---|
| `session_transition_internal` | no |
| `court_booking_transition` | **authenticated** |
| `order_transition` | no |
| `activate_group_membership_paid` | no |
| `membership_abandon_unpaid` | no |
| `session_abandon_unpaid` | no |
| `court_booking_confirm_payment` | no |
| `court_booking_expire_payment` | no |
| `settle_transfer`, `fail_transfer` | no |
| `rate_session` | **authenticated** |

Only two are client-reachable, and both are safe. `rate_session` (full source read)
requires `auth.uid() = sessions.player_id`, refuses unless `status = 'completed'`,
refuses a second rating with `ALREADY_RATED`, takes `for update`, and touches no money
column. `court_booking_transition` is the state machine itself.

**Triggers checked too**, since a trigger is a status writer that no function grep would
find. Every trigger on the nine money tables is `set_updated_at`, plus
`group_memberships_sync_chat` (chat membership only) and
`ledger_entries_assert_balanced`. None writes a status.

### The money-bearing actions are pushed out of the RPC deliberately

`session_transition`, the authenticated-facing wrapper, refuses the three actions that
move money and directs the caller to an edge function:

```
USE_EDGE_FUNCTION: completing a session must go through the complete-session edge
  function, which writes the coach earnings accrual
USE_EDGE_FUNCTION: declining a request must go through the decline-session-refund edge
  function, which issues the automatic full refund of any captured payment
USE_EDGE_FUNCTION: cancelling an unanswered request must go through the
  cancel-session-refund edge function, which issues the automatic full refund
```

Ledger-writing functions are service-role only, confirmed from `proacl`:
`settle_refund`, `claim_order_refund`, `renew_group_membership` all grant EXECUTE to
`service_role` and nothing else. The `.update({status: "failed"})` calls in
`donate/index.ts:238,286`, `book-session:480`, `join-group:266` and
`renew-group-membership:253` are all against `payment_intents` inside edge functions
under the service role, which is the sanctioned writer.

---

## 5. Pending refunds

10 pending, Rs 10,000.00. All 10 are `session` domain, all 10 have a `failure_reason`,
all 10 have `razorpay_refund_id` null and `ledger_entry_group_id` null, and all 10 sit
against a `payment_intent` still in `captured`. So no money has moved for any of them.

| Status | n | Total | Oldest | Newest | No rzp id | Max attempts |
|---|---|---|---|---|---|---|
| pending | 10 | 10,000.00 | 2026-07-27 01:20 | 2026-08-03 22:42 | 10 | 1 |
| processed | 7 | 7,000.00 | 2026-07-20 09:24 | 2026-08-03 22:44 | 0 | 1 |

Every failure reason is the same shape:

```
Razorpay POST /payments/pay_E2ECO0543110343/refund failed (404):
{ "message":"no Route matched with those values" }
```

`pay_E2ECO...` and `pay_CO0441405930` are synthetic e2e payment ids. Razorpay 404s
because the payment never existed. **No real customer is owed any of this Rs 10,000.**
That matches the known state: real refunds cannot be exercised because the payment ids
are synthetic.

### F-2 (P1): they are behind the wrong trap, and it is a worse one

The task premise names `REFUND_IN_PROGRESS`. **These 10 are not behind it.**
`REFUND_IN_PROGRESS` is raised only by `claim_order_refund`
(`supabase/migrations/0095_admin_order_refund.sql:185`) and is backed by:

```sql
create unique index refunds_one_pending_per_order on public.refunds (domain, entity_id)
  where (domain = 'commerce' and status = 'pending' and entity_id <> payment_intent_id);
```

Commerce only, and there are zero commerce refunds. The index that actually traps these
10 is a different one, from the same migration (`:73`):

```sql
create unique index refunds_one_per_entity_non_commerce on public.refunds (domain, entity_id)
  where (domain <> 'commerce');
```

**No status predicate.** For a session, once any refund row exists, in any state
including a permanently failed `pending`, no second refund row can ever be inserted for
that session. `REFUND_IN_PROGRESS` at least clears when the pending row settles; this one
never clears.

And there is no path that would settle them:

- `attempts` is 1 on all 10 and `created_at = updated_at` on all 10, so nothing has ever
  re-touched them since the original failure, the oldest 18 days ago.
- The only writers of a refund's terminal state are `settle_refund` and
  `claim_order_refund`, both service-role only.
- **`cron.job` on the live database holds exactly one job**: `expire-stale-holds`, every
  5 minutes. There is no refund retry sweep.
- By design, per `docs/architecture/PAYMENTS.md:350`: "No auto-resume of a failed
  Razorpay call, deliberately... the `refund.processed` webhook is the settle convergence
  path if the call actually went through." For a 404 the call did not go through, so no
  webhook will ever arrive.

The escape hatch is a service-role UPDATE of the existing row. There is no code that does
it and no admin surface that exposes it.

**Why this is P1 rather than noise.** The stuck rows are synthetic, but the trap is
structural. A real Razorpay failure (network timeout, rate limit, a genuine 500) against a
real session leaves a real athlete permanently unrefundable through the product, with the
payment still `captured`, and the only remedy a manual service-role UPDATE. The
`refunds_one_per_entity_non_commerce` index needs `and status <> 'failed'` (or the retry
path needs to update in place rather than insert), and the pending queue needs a sweep or
an admin retry action.

The `refunds` table has a `failed` status in the `refund_status` enum
(`pending, processed, failed`) that nothing in the failure path ever writes. The 404 path
sets `failure_reason` and leaves the row `pending`, which is why the queue reads as 10
in-flight refunds when in truth all 10 are dead.

---

## Defense in depth

### F-3 (P2): TRUNCATE is granted to `anon` on 54 public tables

| Role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE |
|---|---|---|---|---|---|
| `anon` | 62 | 34 | 32 | 32 | **54** |
| `authenticated` | 75 | 51 | 37 | 44 | **71** |

This includes `ledger_entries`, `payment_intents`, `orders`, `sessions`,
`court_bookings`, `payout_accounts` and `transfers`, i.e. every table whose INSERT/UPDATE/
DELETE was carefully revoked. It is the Supabase default `grant all on all tables in
schema public` never fully walked back.

**TRUNCATE ignores RLS entirely.** It is not filtered by policies the way a DELETE is, so
no policy on these tables would stop it.

**What stops it today, stated precisely: PostgREST exposes no TRUNCATE verb.** I found no
reachable path to invoke it with the `anon` or `authenticated` role, so I am not calling
this exploitable. But the only control is an accident of the API layer rather than a
designed one, and this repo has already lost 36 `training_groups`, 64
`group_memberships` and 85 `chat_messages` to a cascade. The remedy is one statement:
`revoke truncate on all tables in schema public from anon, authenticated`.

### F-4 (P2): `fee_config` grants INSERT, UPDATE and DELETE to `anon` and `authenticated`

`fee_config` is the only money-adjacent table where the client roles hold write grants:
`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` for **both** roles. It is
the platform fee source read at `packages/api/src/use-shop.ts:885`, so a writable
`fee_config` would undermine every server-side recomputation that depends on it.

**RLS holds, verified from `pg_policy` rather than inferred.** Policies on `fee_config`:

| Policy | Cmd | Permissive | Expression | Roles |
|---|---|---|---|---|
| `fee_config_select_authenticated` | SELECT | yes | `true` | authenticated |
| `fee_config_insert_admin` | INSERT | yes | `has_role('admin')` | authenticated |
| `fee_config_update_admin` | UPDATE | yes | `has_role('admin')` | authenticated |
| `fee_config_active_insert` | INSERT | **no (restrictive)** | `is_actor_active()` | authenticated |
| `fee_config_active_update` | UPDATE | **no (restrictive)** | `is_actor_active()` | authenticated |

`relrowsecurity = true`. For `anon` there is no permissive policy of any kind, so every
command including SELECT is denied by default. For a non-admin `authenticated` user the
only permissive write policies require `has_role('admin')`. There is no DELETE policy at
all, so DELETE is denied for every client role. The restrictive `_active_` pair further
requires a non-suspended actor.

So the grant is over-broad but not exploitable. Same remedy as F-3: revoke the writes and
leave the admin path to RLS plus the service role.

### F-5: a documentation correction, `CURRENT-STATE.md`

`docs/qa/CURRENT-STATE.md:246` states, under the membership-expiry gap: "No pg_cron jobs
exist anywhere in the repo."

True of the repo, **false of production**. On the live project `pg_cron` is installed
(`pg_extension`) and one job is active:

```
jobid 1 | */5 * * * * | expire-stale-holds | select public.expire_stale_holds(); | active
```

This is the same shape as the webhook entry already in the DISPROVEN section: absence of
config in the tree is not evidence of absence in production. The sentence should read "no
pg_cron job expires memberships", which remains true and is the point being made.

The underlying gap is confirmed and is worse than a missing job. Searching `pg_proc` for
membership functions returns `activate_group_membership_paid, get_group_member_counts,
is_chat_thread_member, is_group_member_live, membership_abandon_unpaid,
renew_group_membership, sync_group_chat_membership`. **There is no expiry function at
all**, so there is nothing for a cron job to call. `supabase/migrations/0104_membership_
expiry_sweep.sql` exists in the repo and its function is absent from the live database,
so 0104 has not been applied.

No live symptom yet: `group_memberships` holds 5 rows across statuses `active` and
`pending`, and `active` rows with `period_end < current_date` currently number 0.

---

## What was ruled out

- **"The ledger is broken."** It is not. 195 groups, 0 unbalanced, and a constraint
  trigger enforces it. A naive `sum(amount)` has produced a false alarm here before;
  the direction-aware sum is the only valid form.
- **"The admin panel writes order status from the browser."** It registers a Refine
  Supabase dataProvider over `orders`, which is a genuine write capability, but no Refine
  mutation hook exists anywhere in `apps/admin/src` and `authenticated` holds no UPDATE
  grant on `orders`. It mutates via the `admin-order-advance` edge function.
- **"`book-court` trusts a client price."** It accepts `price_override`, but only on the
  walk-in branch, and only after `assertCourtPartnerOrStaff` throws `FORBIDDEN` for
  anyone who is not the venue's partner or staff. A self-service request cannot carry the
  field at all.
- **"The e2e specs violate the invariant by writing money tables."** All four writes are
  negative tests asserting refusal, and the courts one re-reads with the service client to
  prove the status did not move.
- **"`anon` can rewrite the fee table."** The grant says yes, RLS says no, and RLS is
  decisive here because `anon` has no permissive policy on `fee_config` at all.
- **"The 10 pending refunds are real money owed."** All 10 carry synthetic
  `pay_E2ECO...` ids that Razorpay 404s. No customer is owed anything.
- **"The 10 pending refunds are stuck behind `REFUND_IN_PROGRESS`."** That trap is
  commerce-only and there are no commerce refunds. They are stuck behind
  `refunds_one_per_entity_non_commerce`, which is stricter and never clears.

## Unresolved

- Whether the 56 orphaned membership intents were created by the recorded `training_groups`
  cascade or by an earlier one. The cascade path is proven from `pg_constraint` and the
  count is consistent, but no `audit_log` correlation was attempted, and the reported
  figure for the incident was 57 against 56 found now. Resolving the difference needs a
  read of `audit_log` around the deletion window.
- Whether any of the 56 orphans predates the incident and was orphaned some other way.
  Their `created_at` spans 2026-07-25 to 2026-08-11, which is wider than a single event.
- Whether `expire_stale_holds` covers unpaid membership holds. `membership_abandon_unpaid`
  exists as a function; whether the cron job reaches it was not traced.
- No runtime proof that a client write is refused was produced in this lane. The grants
  and policies are read from the live catalog and the e2e specs assert refusal, but the
  DB write gate forbids attempting the forbidden write myself, so the refusal is proven by
  catalog and by test source rather than by my own observed error.
