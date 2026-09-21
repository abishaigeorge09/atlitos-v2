# IA: the admin portal, five groups

Gate 1b for Part B of `snappy-foraging-meadow.md`. One page. Source of truth for the grouping
is `apps/admin/src/layout/nav.ts`; this document is a map of it, not a second copy that can
drift.

## The five groups and every route

**Home**
- Dashboard, `/dashboard`

**Operations**
- Verification, `/verification`, detail at `/verification/show/:id`
- Venues, `/venues`, create at `/venues/create`, detail at `/venues/show/:id` (kept here for
  now; PRD-04 does not name a home for it and it predates this grouping, see
  `DIRECTION-ADMIN.md`'s scarcity table note)
- Bookings, `/bookings`
- Orders, `/orders`, detail at `/orders/show/:id`

**Catalog**
- Gear, `/gear`, create at `/gear/create`, detail at `/gear/show/:id`
- Catalog health, `/gear/health`
- Products, `/products`, detail at `/products/show/:id`

**Community**
- Moderation, `/moderation`, detail at `/moderation/show/:id`
- Reports, `/reports`, detail at `/reports/show/:id`
- Drills, `/drills`, create at `/drills/create`, detail at `/drills/show/:id`
- Users, `/users`, detail at `/users/show/:id`

**Settings**
- Fee config, `/fee-config`

Not in the nav on purpose: `/_kitchen` (Gate 1 reference, admin auth gated, `noindex`) and
`/login` (outside the authenticated shell).

## Cold start task path

Sign in at `/login` with the admin account, land on `/dashboard` (the `index` route redirects
here via `NavigateToResource`), open **Operations > Verification** in the sidebar, pick the
oldest pending request, open its detail at `/verification/show/:id`, review the submitted
evidence, click **Approve**. No confirm dialog on approve (only reject requires one, per PRD-04
3.3's required reject reason); a toast confirms the action and the row leaves the pending queue.

## Data entry task path

Open **Catalog > Gear** in the sidebar, click **Add gear** (the `PageHeader` primary action on
the list), land on `/gear/create`. Either paste a retailer URL into "Add from a link" and let it
prefill the form (Decathlon and most retailers), or fill the sectioned form by hand (Amazon
links cannot be fetched and say so, per `PLAN-ADMIN-UX.md`'s A3 gate). Save; the `SaveBar`'s
primary action commits the product, a success toast fires, and the new row appears at the top
of the Gear list.
