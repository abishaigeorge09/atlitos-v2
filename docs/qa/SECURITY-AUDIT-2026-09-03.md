# Security audit — 2026-09-03

Scope: `supabase/functions` (23 edge functions + `_shared`), `supabase/migrations` (87), `packages/api`, `apps/mobile`, `apps/portal-court`, `apps/portal-life`, `apps/admin`, `scripts`. Static review at commit `1199955`, no live project access.

Five findings. One is a P0 that was fixed in this pass; the rest are reported, not changed. Regression cases for the P0 are `SEC-01` / `SEC-02` in `docs/qa/test-catalog.json`, implemented in `apps/e2e/specs/security.spec.ts`.

## SEC-F1 (P0, FIXED) — arbitrary read of the private `clips` bucket via `thumb_path`

`supabase/functions/stream-webhook/index.ts`

`thumb_path` arrived from the request body, was validated only as "a non-empty string", and was written verbatim to `clips.thumb_path` under the **service role**:

```ts
if (body.thumb_path) {
  await supabase.from("clips").update({ thumb_path: body.thumb_path }).eq("id", clip.id);
}
```

Both signed-URL mints then hand that column straight to storage with no further check:

- `get-clip-playback-url/index.ts:103` — `if (clip.thumb_path) thumbUrl = await mintSignedClipUrl(supabase, clip.thumb_path)`
- `get-clip-moderation-url/index.ts:78` — same shape

`storage_path` is safe because `stream-upload-url` derives it server side as `${user.id}/${clip.id}.mp4`. `thumb_path` had no such derivation and no prefix constraint.

**Exploit chain**, any authenticated user, no special role:

1. `stream-upload-url` -> own clip row + signed upload URL under own folder.
2. PUT a few placeholder bytes so `objectExists` passes.
3. `stream-webhook` with `{ clip_id: <own clip>, thumb_path: "<victim_uuid>/<victim_clip>.mp4" }`. The ownership check passes (the clip is theirs); the path is not theirs and nothing checks that.
4. `get-clip-playback-url` on their own clip. The FB-004 owner branch grants unconditionally, so the server mints and returns `thumbUrl` — a live 300s signed URL for the victim's object.

Reachable objects: everything in the private `clips` bucket, including clips still `uploading`, and `rejected` / `removed` clips. That is precisely the set the takedown model exists to hide, and the mint is doing the reading, so no storage RLS policy is in the path to stop it. Publishing the attacker's clip hands the same `thumbUrl` to every viewer of the feed.

**Fix applied** — constrain the path to the caller's own owner-id folder, the same prefix `stream-upload-url` already derives `storage_path` under, and refuse traversal segments:

```ts
const ownPrefix = `${user.id}/`;
if (!body.thumb_path.startsWith(ownPrefix) || body.thumb_path.split("/").includes("..")) {
  throw new AppError("FORBIDDEN", "thumb_path must be an object inside your own upload folder.", 403);
}
```

No caller passes `thumb_path` today (`apps/mobile/src/app/(tabs)/clutch/upload.tsx:97` calls `finalizeUpload(ticket.clipId)` with no second argument), so the guard breaks nothing. Deleting the parameter outright would also close it, but the contract is documented in `VIDEO.md` and carried through `packages/api/src/hooks.ts:1413`; the guard is the smaller change.

**Deploy note:** the fix only takes effect once `stream-webhook` is redeployed. Until then the live function is exploitable.

## SEC-F2 (P1, NOT FIXED) — court partner earnings overstates the withdrawable balance

`apps/portal-court/src/app/dashboard/earnings/page.tsx:92,106,115`

```ts
const pendingCredits = (ledgerResult.data ?? []).reduce((sum, e) => sum + e.amount, 0);
transferredTotal = transfers.reduce((sum, t) => sum + t.amount, 0);
pendingBalance: Math.max(0, pendingCredits - transferredTotal),
```

`direction` is selected on line 68 and never used. The canonical definition is `get_payout_account_balance` (`0028_route_transfers.sql`):

```sql
sum(case when le.direction = 'credit' then le.amount else -le.amount end)
```

`record_transfer` writes the transfer's **debit** leg against `account_type = 'court_partner'`, `account_ref = <venue owner>` — the same rows this query reads. So a debit of `T` is added as `+T` instead of `-T`, and then `T` is subtracted again as `transferredTotal`. Net: `(C + T) - T = C`. The screen shows the partner their gross accrual and calls it a pending balance, overstating what is actually withdrawable by exactly the amount already paid out.

Second error in the same expression: `transferredTotal` sums transfers in **every** status. A `failed` transfer already has a reversing credit group in the ledger (`fail_transfer`), so it nets to zero there and is then subtracted a second time here, understating the balance by that amount.

This is display-only — `razorpay-route-transfer` re-derives against `get_payout_account_balance` server side and refuses `INSUFFICIENT_BALANCE`, so the number cannot cause an over-withdrawal. It is still a money figure shown to a partner that does not match the ledger.

Left unchanged deliberately: `CLAUDE.md` routes money-bearing changes through the biased-approver gate, and this is not our repo. The one-line correction is to use `direction` in the reduce and drop `- transferredTotal`, making the expression identical to the RPC's.

No regression case written for it: Route is not enabled on the test merchant account, so the test project has no `transfers` rows and any assertion would pass vacuously — the failure mode `CLAUDE.md`'s third RLS incident warns about. It needs a fixture with a settled transfer first.

## SEC-F3 (P3) — non-constant-time comparison of the service role key

`supabase/functions/_shared/notify.ts:253` — `if (!serviceKey || bearer !== serviceKey)`.

`notify-dispatch` writes a `notifications` row for an arbitrary `user_id`, so this compare is the whole authorization. A plain `!==` on a secret leaks its prefix through timing. Practically very hard to exploit across the edge network against a JWT-length key, which is why this is P3 and not higher.

`_shared/razorpay.ts:120` already has a `timingSafeEqual` used for both webhook signature checks; exporting it and using it here is the whole fix.

## SEC-F4 (P3) — no rate limit on the LLM-backed search endpoint

`supabase/functions/ai-search/index.ts`. `verify_jwt` is true, but `0008_anonymous_user_support.sql` means anyone can mint an anonymous session, and the function then calls Anthropic twice per request (`llmParseIntent`, `llmRerank`) once `ANTHROPIC_API_KEY` is set. Input is bounded (`query` <= 200 chars, `limit` clamped to 50) so this is cost amplification, not data exposure. Worth a per-user throttle before the key is activated.

## SEC-F5 (informational) — `Access-Control-Allow-Origin: *` on every edge function

`supabase/functions/_shared/cors.ts`. No credentials are reflected and auth is bearer-token only, so this is not CSRF-exposed. It does mean any origin can invoke these functions from a browser with a token it already holds. Fine as built; noted so a future cookie-based session does not inherit it silently.

## What held up

Checked and found correct, so the shape of the codebase is worth recording:

- **No secrets committed.** The only keys in the tree are `apps/mobile/eas.json`'s `EXPO_PUBLIC_*` set: a Supabase publishable anon key and a Razorpay **test** key id, both public by design. No service role key, no `RAZORPAY_KEY_SECRET`, no `RAZORPAY_WEBHOOK_SECRET`, no private keys anywhere in the working tree.
- **Financial invariant holds.** No client-side `.insert()` / `.update()` against `payment_intents`, `ledger_entries`, `payout_accounts`, `transfers`, or `refunds` anywhere in `apps/` or `packages/`. Every hit is a read; every write is an edge function under the service role.
- **Webhook signature verification is correct.** HMAC-SHA256 over the **raw** body (not re-serialized JSON), constant-time compare, and idempotency keyed on the `x-razorpay-event-id` header with an insert-before-side-effect gate.
- **Identity is never taken from the body.** `getAuthenticatedUser` round-trips to GoTrue rather than decoding the JWT locally. `book-court`'s `price_override` — the one client-supplied price in the tree — sits inside the walk-in branch behind `assertCourtPartnerOrStaff`. `checkout` re-derives the bill and raises `PRICE_MISMATCH`.
- **`CLAUDE.md`'s permissive-OR RLS rule is actually followed.** Every `venues` read in `portal-court` carries its own `.eq("partner_user_id", user.id)` or the owned-or-staffed `.or()` filter. No unscoped read found.
- **Storage bucket visibility is deliberate.** `clips`, `coach-certificates`, `upa-evidence` private; `avatars`, `venue-media`, `product-media`, `upa-photos`, `gratitude-photos` public. Matches what each holds.
- **`apps/admin` ships no service role key.** The admin gate is a UX gate over `user_roles`, with RLS as the actual enforcement, and re-checks on every session.
- **Trainee video paths are server-derived** (`coach-videos/${coach_id}/${player_id}/${id}.mp4`) with an ownership check on both the mint and the read — the shape `thumb_path` was missing.
