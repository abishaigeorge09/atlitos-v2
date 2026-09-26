# Plan: manual payouts, affiliate click tracking, court and gear search

Written 2026-09-25. Founder direction, same day: settle coaches and venues by collecting their
bank details, because Razorpay Route is closed to ELSHEPH until about Rs 40L of taxable turnover
(RBI rule, ticket #21108352); then really work on AI search for courts and gear.

RazorpayX is active on the account but its Lite balance is unfunded, no IP is allowlisted and no
X webhook exists, so payouts are MANUAL (NEFT or UPI by a human) until those land. Everything
below is built so the automatic RazorpayX run later replaces exactly one step, "a human sent the
money", and nothing else.

## Track 1. Payout methods and the manual payout run

Money invariant (CLAUDE.md): clients never write money rows. Bank details are not money rows but
are treated harder, because whoever controls them controls where money goes.

- `payout_methods`: one row per `payout_accounts` row. Bank account plus IFSC, or UPI VPA, plus
  holder name and PAN. RLS on, zero policies, no grant to `anon` or `authenticated`. Only
  security definer RPCs touch it.
- `upsert_my_payout_method`: the owner (coach, or the venue's partner) saves details. Validates
  IFSC, account number, VPA and PAN formats. ANY change resets verification and moves the payout
  account to `pending`, so a hijacked account cannot redirect money before an admin re-verifies.
- `get_my_payout_method`: masked read for the owner (last four digits only).
- `admin_reveal_payout_method`: full details for an admin, and every reveal writes `audit_log`.
- `admin_verify_payout_method`: verify or reject. Verify sets the payout account `active`, which is
  the status `record_transfer` already requires. No new gate, the old one gains a second meaning.
- `get_payout_eligible_balance`: balance minus anything still inside the hold. Sessions and
  memberships: credited at least 24 hours ago. Courts: the booked slot has ended at least 24
  hours ago, because venues are credited at booking time and a cancelled slot must not already be
  paid out.
- `admin_payouts_due`: every account with an eligible balance above a minimum.
- `admin_record_manual_payout`: admin enters amount and the bank reference (UTR). Reuses the same
  lock, balance check and ledger group as `record_transfer` through one shared core. The
  reference is unique, so the same UTR can never be recorded twice.
- Admin page "Payouts": due list, reveal, verify, record paid.
- Coach (mobile) and venue (portal-court) screens: replace the Route hand-off with the form.

Acceptance, each proved by a script against the local stack, born red:
1. A coach cannot read or write `payout_methods` directly (42501), and cannot read another
   coach's masked method. Isolation test asserts the two ids differ.
2. Changing a verified method returns the account to `pending` and `record_transfer` refuses it.
3. A non-admin calling any `admin_` payout RPC gets FORBIDDEN.
4. Eligible balance excludes a session completed one hour ago and a court slot not yet played.
5. Recording the same UTR twice writes one ledger group.
6. Every reveal writes one `audit_log` row.

## Track 2. Affiliate click tracking

- `affiliate_clicks`: one row per Buy tap. Offer, product, retailer, user (nullable for guests),
  surface, and a `click_id` that is also appended to the outbound URL as a subid, so a retailer's
  commission report can be reconciled row by row.
- `record_affiliate_click` RPC returns the tagged URL; the app opens THAT URL. Recording never
  blocks the shopper: on failure the untagged URL opens.
- Admin: clicks per product and retailer on the reports page.

## Track 3. Court search that understands time

Today `ai-search` parses "evening" into `timeWindow` and then uses it nowhere, compares against
the court's base price rather than the slot price, ignores city for courts, and scores 50
arbitrary rows.

- Parse date (today, tonight, tomorrow, weekday names, weekend) and time (7pm, 7 to 9pm,
  morning, evening) in the deterministic path; the Claude path returns the same fields.
- `search_court_slots` SQL function: verified venues only, sport, date, time range, price ceiling
  applied to the REAL slot price after peak rules, city or distance, past slots excluded in IST.
  Returns each court with its first matching free slot.
- Courts tab gets a search box. Results read "Free at 7:00 PM, Rs 450".
- Acceptance: "badminton tonight after 7 under 500" returns only courts with a free slot after
  19:00 today whose slot price is at most 500; a fully booked court is absent; a court whose base
  price is 400 but whose 7pm peak price is 600 is absent.

## Track 4. Gear search recall that survives a real catalogue

- Postgres full text search (`tsvector` over title, brand, sport, description) replaces the
  "first 50 rows" keyword recall, merged with the existing Voyage vector recall.
- Acceptance: with 500 local fixture products, a query for an item that sorts last alphabetically
  is still found. Fixtures are LOCAL ONLY and never reach production.

## Order

Track 1, then 2, then 3, then 4. Docs (`PAYMENTS.md`, `SCHEMA.md`, `API-MAPPING.md`, `DEBT.md`)
change in the same commit as the code they describe.

## Not in this plan

RazorpayX automatic payouts (needs funding, IP allowlist, webhook), GST and TDS treatment (CA),
academies, bulk catalogue entry.
