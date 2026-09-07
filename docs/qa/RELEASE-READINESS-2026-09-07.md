# Release readiness: go/no-go review

Date: 2026-09-07. Scope: everything in the working tree at this commit, run as
a release manager review against the launch checklist. Evidence is a command
output, a file:line, or a setting name. "I did it" is not evidence, and an
item with no evidence is UNVERIFIED, which counts as missing.

---

## 1. Overall verdict

**NO-GO for public App Store release.**
**GO for internal TestFlight, with two caveats stated in section 6.**

The verdict is NO-GO because privacy, legal and deployment items are
UNVERIFIED, and the rule is that an unverified control is a missing control.
Specifically: no privacy policy exists, no terms exist, no content policy
exists, and not one line of the security work in this repository is running in
production. That last point is worth stating plainly because it is easy to
misread a green test suite as a safe system: **every fix below is proven on a
laptop and inert in production.**

Nothing here is a reason to be discouraged. The build is in good shape and the
remaining work is mostly writing and deploying, not engineering.

---

## 2. What was verified in this pass, with evidence

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | Typecheck, build, lint across the monorepo | **GO** | `pnpm turbo typecheck build lint` -> `Tasks: 24 successful, 24 total`, exit 0 |
| 2 | Every edge function type checks | **GO** | `deno check` over all 24 `supabase/functions/*/index.ts`, zero failures |
| 3 | Migration chain replays from scratch | **GO** | `./scripts/verify-migrations-local.sh` applies all 95 migrations, exit 0 |
| 4 | SQL security assertions | **GO** | 60 assertions pass (was 30). Negative control confirmed: flipping `clips_hide_blocked` from RESTRICTIVE to PERMISSIVE fails the suite with the exact expected message |
| 5 | No secrets in the tree | **GO** | `./scripts/check-tokens.sh` and `./scripts/check-release-config.sh` both pass. Only `EXPO_PUBLIC_*` values, public by design |
| 6 | Financial invariant holds | **GO** | No client-side write to `payment_intents`, `ledger_entries`, `payout_accounts`, `transfers`, `refunds` in `apps/` or `packages/` |
| 7 | Export compliance declared | **GO** | `ITSAppUsesNonExemptEncryption: false` in `apps/mobile/app.json` |
| 8 | Permission strings specific, no unused permissions | **GO** | `npx expo config --type introspect` now emits exactly three usage strings, all specific. Camera, microphone and both Always-location entries removed |
| 9 | In-app account deletion exists | **GO (code)** | `delete_my_account()` 0093, `delete-account` edge function, Settings row. 9 assertions. **Not deployed** |
| 10 | Report objectionable content | **GO (code)** | `useClutch().report()`, reason picker on the feed card. **Not deployed** |
| 11 | Block a member | **GO (code)** | `user_blocks` 0092 + two RESTRICTIVE policies, 8 assertions. **Not deployed** |
| 12 | LLM spend ceiling | **GO (code)** | 30/min per user and per IP, enforced before the Anthropic calls, fails closed. 9 assertions. **Not deployed** |

## 3. What is NO-GO or UNVERIFIED

| # | Check | Verdict | Why, and what would change it |
|---|---|---|---|
| 13 | Privacy policy live at a public URL | **NO-GO** | Does not exist. Zero matches in `apps/mobile/src` or `apps/landing`. Required by App Store 5.1.1 and by DPDP. Must state that money records are retained after deletion, because they are |
| 14 | Terms of service | **NO-GO** | Does not exist |
| 15 | Content policy for user content | **NO-GO** | Does not exist. Guideline 1.2 requires it published, in app and on the site |
| 16 | Published support contact | **NO-GO** | No support address anywhere in the app. Guideline 1.2 requires a monitored contact |
| 17 | Security fixes deployed | **NO-GO** | `supabase db push` and `supabase functions deploy` have never run for 0088 to 0095. Production still has every P0 from the 2026-09-03 and 2026-09-04 audits |
| 18 | EAS production secrets set | **NO-GO** | `build.production.env` was deliberately stripped, so a production build FAILS CLOSED until `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and a live `EXPO_PUBLIC_RAZORPAY_KEY_ID` exist as EAS secrets. This is correct behaviour, and it is a hard prerequisite |
| 19 | Privacy nutrition label matches real traffic | **UNVERIFIED** | Cannot be read from this repository. Must be audited against actual network calls: Supabase, Razorpay, Anthropic |
| 20 | Leaked password protection | **UNVERIFIED** | Supabase dashboard setting for project `syzzfgaudpifwvbpycyi`. Not reachable from code (SEC-F8) |
| 21 | `custom_access_token_hook` still registered | **UNVERIFIED** | Auth > Hooks. If it was ever removed, the token denial layer for suspension AND deletion is silently inert. The edge and RLS layers still hold, which is why it is not the only layer |
| 22 | MFA on privileged accounts | **UNVERIFIED** | Apple, Supabase, Razorpay, GitHub, email. Cannot be checked from here |
| 23 | Backups exist and a restore was proven | **UNVERIFIED** | No restore has been performed. An untested backup is a hypothesis |
| 24 | Prepaid credits rather than a linked card | **UNVERIFIED** | Anthropic and Razorpay billing. A spend alert is not a cap |
| 25 | e2e truth lane | **UNVERIFIED** | `apps/e2e` needs `SUPABASE_SERVICE_ROLE_KEY` and the live deploys. `security.spec.ts` SEC-01 to SEC-07 are written and have never executed |
| 26 | Cross-user access tested as a real second user | **PARTIAL** | Proven in SQL against a scratch database with a real second identity. NOT proven against the deployed system |
| 27 | Real users have used it | **NO-GO** | External TestFlight has not run |

---

## 4. Shortest path to GO, in order

Each step unblocks the next. Steps 1 to 4 are the ones that need someone with
project credentials, which this session did not have.

1. **Write the three documents and publish them.** Privacy policy, terms,
   content policy, plus a monitored support address. This is the longest lead
   item because it is writing, not code, and items 13 to 16 all depend on it.
   The privacy policy must say that orders, payment intents, ledger entries and
   donations survive account deletion in anonymized form, because 0093 makes
   that true on purpose.
2. **Deploy.** `supabase db push` for 0092 to 0095, then
   `supabase functions deploy` for ALL functions, not a subset. `_shared/http.ts`,
   `_shared/supabase.ts`, `_shared/app-error.ts` and `_shared/rate-limit.ts` are
   bundled at deploy time, so a partial deploy leaves some functions still
   serving deleted accounts. Confirm `supabase migration list` first: 0027 is
   almost certainly already applied and its repaired file must not be replayed.
3. **Set the three EAS production secrets.** Production builds fail closed
   until then, by design.
4. **Verify the four dashboard items** (20, 21, 22, 24) by looking at each one
   and writing down what you saw.
5. **Run the e2e truth lane** against the deployed system:
   `E2E=1 SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @atlitos/e2e test`.
6. **Prove a restore.** Restore a backup into a scratch project and open it.
7. **Internal TestFlight, then external.** External TestFlight triggers Beta App
   Review, which does check guideline 1.2, so steps 1 and 2 must precede it.

---

## 5. The three things most likely to go wrong in week one

**1. A member deletes their account and something is still holding their data.**
The purge in `delete_my_account()` is an explicit list of tables. It was written
against the FK graph as it exists today, and two of my first guesses about
column names were wrong and were caught by the test suite. A table added later,
or one I missed, stays populated silently, and nothing alerts on it.
*Have ready:* a query that counts rows still referencing a `deleted_at is not
null` user across every table with a `users` FK. Run it after the first real
deletion. If it returns anything, add the table to the RPC and re-run.

**2. The rate limit refuses real users.** 30 per minute per IP is generous for a
person and tight for a shared network. A gym, a college campus or a corporate
NAT puts many members behind one IP, and they will hit the IP key together while
each individual user key is nearly empty.
*Have ready:* the decision to raise the IP limit specifically, not the user
limit, and a `select bucket_key, max(count) from rate_limit_counters group by 1
order by 2 desc limit 20` to see which key is actually saturating before you
change a number.

**3. A charge captures and its downstream work fails.** 0088 built the recovery
path, but repair only happens on the NEXT delivery of a capture. Nothing
re-invokes finalization on its own, by explicit prior decision.
*Have ready:* `select * from payment_finalization_backlog()` on a schedule you
actually look at, and the knowledge that a non-empty result means a member paid
and did not get what they paid for. That is a phone call, not a ticket.

---

## 6. Rollback plan, as steps you could follow at 2am

Read this top to bottom before doing anything. The order matters, and step 0
is not optional.

**0. Decide what is actually broken.** Mobile app, edge functions, or database?
Rolling back the wrong layer makes it worse.

**If the mobile build is bad:**
1. App Store Connect > TestFlight > the build > Expire.
2. Testers on the previous build are unaffected; testers on the bad one are
   prompted to update to the previous build.
3. There is nothing to undo server side. Stop here.

**If an edge function is bad:**
1. `git checkout <last known good sha> -- supabase/functions/`
2. `supabase functions deploy` (ALL of them, same reason as the deploy note).
3. Verify with one real call, not by reading the deploy output.
4. Do NOT roll back migrations for this. The functions are the newer half; the
   schema tolerates the older functions because every change in 0092 to 0095 is
   additive.

**If a migration is bad, in order of preference:**
1. **Prefer forward.** Write a new migration that reverses the specific thing.
   The four in this batch are additive and individually reversible:
   - 0092: `drop policy clips_hide_blocked on public.clips;`
     `drop policy clip_comments_hide_blocked on public.clip_comments;`
     `drop table public.user_blocks;`
     Dropping the two policies alone restores the old feed behaviour and is the
     smaller, safer move. Do that first and stop if it fixes it.
   - 0093: re-create `is_active_user()` and `custom_access_token_hook` from
     0090 to drop the `deleted_at` arm; `drop function delete_my_account();`.
     Leave the `deleted_at` COLUMN alone. Dropping it destroys the record of
     who asked to be deleted, which you cannot reconstruct.
   - 0094: `drop function chat_thread_previews(uuid[]);` and redeploy the
     previous `use-chat.ts`. The client is the only caller.
   - 0095: re-create `expire_stale_holds()` from 0088 to remove the prune arm,
     then `drop function prune_rate_limit_counters();`,
     `drop function rate_limit_hit(text,integer,integer);`,
     `drop table rate_limit_counters;`. Dropping the table while `ai-search`
     still calls the function makes search fail CLOSED, which is by design and
     will look like an outage. Redeploy `ai-search` first, or accept it.
2. **Do not `supabase db reset` against production.** It drops everything.
3. **Restore from backup only as a last resort**, and only after you have
   written down the current time, because everything after the snapshot is gone.

**If money is involved, at any layer:** stop and do nothing destructive.
`ledger_entries` is append only and is the record of what happened. A rollback
that deletes ledger rows destroys the evidence you need the next morning.
Disable the affected feature (`feature_flags`) and leave the data alone.

---

## 7. Known gaps, deliberately not closed

Stated so the next person does not have to rediscover them.

- **No unblock screen.** `blockedUserIds()` and `unblockUser()` exist in
  `packages/api`; no UI calls them. Apple requires the ability to block, not to
  unblock, so this does not block submission, but a member who blocks by
  accident is currently stuck. This is the top follow up.
- **62 `exhaustive-deps` warnings.** The rule now runs for the first time (it
  was suppressed against an unregistered plugin, so `pnpm lint` was red AND no
  dependency array had ever been checked). The root cause behind almost all of
  them, 15 API hooks returning a fresh object every render, is fixed. The
  remaining warnings are now truthful and safe to act on individually.
- **Two N+1 reads.** `lib/group-sessions.ts:32` and
  `trainings/upcoming.tsx:71` issue one query per group. Bounded by a member's
  group count, which is small today.
- **The court earnings balance formula is duplicated** between
  `portal-court/.../earnings/page.tsx` and `get_payout_account_balance` (0028).
  Forced, because that RPC is service role only for good reason. Marked with a
  `ponytail:` comment.
- **SEC-F8**, leaked password protection, is a dashboard setting.
