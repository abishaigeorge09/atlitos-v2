# Atlitos infrastructure: access, credentials, and how to work here

For Prasanth as CTO. Written 17 September 2026 from a live audit of every service.
No secret value appears in this file, and none ever should: every credential lives in
the service that uses it, and access is granted by invitation to a named account, never
by pasting a key into a chat or a repo.

## 1. Read these first

1. `CLAUDE.md` at the repo root. It is the entry point for every agent and every person.
2. `docs/BRANCHING.md`. Six rules. `main` is canonical, everyone branches from it,
   migrations take their number at merge time. Written on 14 September because two
   histories that never met cost a day; on 16 September it happened again (section 8).
3. `docs/qa/CURRENT-STATE.md`, especially the DISPROVEN section.
4. `docs/ops/DATA-ENTRY.md` if you are setting up the data entry team.

## 2. The surfaces and where they run

| Surface | Code | Live URL | Hosting |
|---|---|---|---|
| Marketing site | `apps/landing` | https://atlitos.com | Vercel `atlitos-landing` (`prj_lpqOU5k4LE9ALxvyid48wSKMIPax`) |
| The app on the web | `apps/mobile` (Expo web export) | https://atlitos-app.vercel.app | Vercel `atlitos-app` (`prj_1uhpCkWq0riA4sefUnn9yEWnDCM0`) |
| Court partner portal | `apps/portal-court` | https://atlitos-portal-court.vercel.app | Vercel `atlitos-portal-court` (`prj_GpJ2lauFEpztmfMLmGwpDaSeA7LT`) |
| Atlitos Life portal | `apps/portal-life` | https://atlitos-portal-life.vercel.app | Vercel `atlitos-portal-life` (`prj_J4LnWem7VXzRRVObNIEFB8PAnHCd`) |
| Admin back office | `apps/admin` | https://atlitos-admin.vercel.app | Vercel `atlitos-admin` (`prj_I36aP8x8EAAWeKm4x7OBtfvf50bl`) |
| iOS and Android apps | `apps/mobile` | TestFlight build 3 (July), stores not yet submitted | EAS |

All five Vercel projects live on team `abishaigeorge09s-projects` (`team_gbBiqgTktOYto5eu84aDKCT3`,
Pro plan). **None is linked to GitHub.** A git push deploys nothing; every deploy is a
manual `vercel --prod` from the right directory, with per-app quirks (portal-life deploys
from the repo root, the app deploys a prebuilt `dist` with an SPA rewrite). The recipe is
in `docs/qa/CURRENT-STATE.md` under deploys. Linking the projects to the repo so `main`
auto-deploys is the right next step and is listed in section 9.

A sixth Vercel project named `portal-court` (no `atlitos-` prefix) is an older duplicate
and is not the live one.

## 3. Backend

**Supabase**, one production project: `syzzfgaudpifwvbpycyi` (`https://syzzfgaudpifwvbpycyi.supabase.co`).
Postgres with RLS, 28 edge functions under `supabase/functions`, Storage buckets, pg_cron on,
pg_net off (two vault secrets and pg_net are on the go-list for push notifications).

Rules that are not negotiable, from `CLAUDE.md`:
- Production is treated as read only from any agent session. Migrations are applied by a
  person, deliberately, after a clean `supabase db reset` replay locally.
- RLS is permissive-OR and is a floor, not scoping. Every read carries its own owner filter.
- Clients never write money rows. Money moves only through SECURITY DEFINER RPCs and edge
  functions under the service role.

Local development: Colima plus Docker, `supabase start`, `supabase db reset` replays all
migrations (118 as of today, 0120 is the newest and its number is provisional) and the
seed. `scripts/assert-build-target.sh` proves a build points at local before any QA run;
`scripts/lib/guard-target.mjs` refuses to let a cleanup script touch production.

**Migration state, production vs repo.** Applied through `0117` plus the money set
(`0107`, `0108`, `0109`) and the leak closes (`0116`, `0117`). Still to apply from the
reconciled line: `0110`, `0112`, `0113`, `0114`, `0115`, `0118`, `0119`, and now `0120`.
Two edge functions written but not deployed: `delete-account`, `notify-push-sweep`.

## 4. Every credential, where it lives, and who grants access

| Service | What it holds | Where the secret lives | How you get access |
|---|---|---|---|
| Supabase project `syzzfgaudpifwvbpycyi` | database, auth, storage, edge functions, service role key, anon key | Supabase dashboard (Project Settings, API); edge function secrets in Supabase Vault / function secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `SENTRY_ENV`, plus the auto-injected `SUPABASE_*`) | Abishai invites your email to the Supabase organisation with the Developer role. Never share the service role key; the dashboard and the CLI use your own login |
| Vercel team `abishaigeorge09s-projects` | the five deployments and their env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN` on admin; the `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` equivalents on the others) | Vercel project settings, Environment Variables | Abishai adds you as a team member (Pro plan, one paid seat). Until then, GitHub write plus linked projects is the alternative in section 9 |
| Expo / EAS project `@synthorgtech/atlitos-mobile` (`5976cc18-...`) | native builds, submit credentials, EAS environment variables | EAS dashboard, Environment variables. **Empty today in all three environments**; the production profile in `eas.json` no longer hardcodes anything, so a production build needs `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_RAZORPAY_KEY_ID`, `EXPO_PUBLIC_SENTRY_DSN` created there first | The project sits under the Synth Expo organisation (`synthorgtech`, login `founder@synthsports.co`), not an Atlitos one. Abishai invites you to that org, or moves the project to an Atlitos org (cleaner, and listed in section 9) |
| Apple Developer team `4U493SXP52` | signing, App Store Connect app `6793626237` (`com.atlitos.app`), TestFlight | Apple; an App Store Connect API key exists for the team (key id `5KR4Q7NM99`) and is used by EAS submit | Abishai invites your Apple ID as App Manager in App Store Connect and as a member of the developer team. The team is shared with other apps (BelieversDiary, synth) |
| Google Play | Android listing | Play Console under the ELSHEPH org account, developer `8696807675061268676` | Abishai grants your Google account on that developer account |
| Razorpay | payments, Route payouts, webhooks | Razorpay dashboard; keys in Supabase function secrets and `EXPO_PUBLIC_RAZORPAY_KEY_ID` on EAS | Currently a test key only; the live account is being opened directly with Razorpay (the reseller account was abandoned). Abishai adds you as a dashboard user once KYC completes |
| Sentry org (Atlitos) | five DSNs, one per surface, alerts | Sentry; DSNs on Vercel and EAS as above | Abishai invites you to the Sentry org |
| GitHub `abishaigeorge09/atlitos-v2` | the code | GitHub | You are `pr6760` with read today; the write invite is being sent (section 9). `p24studios` also has write; if that is not you, it needs a name |
| Jira project `ATL` | tickets, 12 epics | Atlassian | Abishai adds you to the site |

Nothing above is stored in the repo. `.env` files are local only and ignored; `.env.example`
files in each app list the names you need. If you ever find a real key committed, treat it as
leaked: rotate it first, then remove it.

**One security finding to act on:** the GitHub repo is **public**. Nothing secret is in it,
but the product code, PRDs, QA evidence and internal docs are readable by anyone. It should
be private. The free plan's inability to enforce a required check on a private repo is
already handled by the pre-push hook (`docs/DEBT.md`).

## 5. Local setup, in order

```
export PATH=/opt/homebrew/bin:$PATH      # Homebrew node, nvm's default is too old
git clone https://github.com/abishaigeorge09/atlitos-v2 ~/dev/atlitos && cd ~/dev/atlitos
pnpm install
supabase start                           # needs Docker (Colima on a Mac)
supabase db reset                        # replays every migration and the seed
cp apps/admin/.env.example apps/admin/.env.local     # and the same for each app you run
pnpm turbo typecheck lint                # the gate; must be green before any push
```

Each app's `.env.example` names its variables. Point them at the local stack
(`http://127.0.0.1:54321` and the local anon key from `supabase status`) for everything
except a deliberate production check. `bash scripts/assert-build-target.sh <app> local`
before any native QA run; it exists because QA once ran against production for an
afternoon without anyone noticing.

Native: iPhone 16 Pro Max simulator `8AF6A5E2-F889-4477-8634-97B4AB5D5453`, Release
builds only for QA, Maestro flows pinned with `--udid` (never the directory form). The
full runbook is `docs/qa/EMULATOR-TEST-SESSION.md`.

## 6. How work flows

- Branch from `main` as `prasanth/<topic>`. Agent sessions use `integration/<topic>`.
- Migrations are named `XXXX_<name>.sql` while the branch lives and get the next free
  number at merge.
- Nothing reaches `main` without `pnpm turbo typecheck lint` green on the merged result.
- Every UI change is proven with a Release build screenshot on the device plus a Maestro
  run, before it is called done.
- Tickets in Jira `ATL`; move to In Progress when you start, In Review with a one-line
  note when done.

## 7. Release facts

- Bundle `com.atlitos.app`, scheme `atlitos://`, EAS project id `5976cc18-...`, ASC app id
  `6793626237`, Apple team `4U493SXP52`.
- iOS build 3 (25 July) is the only TestFlight build. TestFlight installs on this Apple
  team have failed for every build uploaded since 12 August, across all apps on the team
  ("requested app is not available"). Five causes were ruled out; the audit script at
  `~/.claude/jobs/8ea01d2a/tmp/asc/testflight-audit.py` reads the account state via the
  API, and Apple Developer Support is the next step if it shows nothing.
- `scripts/check-release-config.sh` fails the gate if a Razorpay test key reappears in
  `eas.json`.
- Release date on the tracker: 8 October 2026. Submission target 30 September.

## 8. The state of `main` on 17 September, and what it means for you

On 14 September the two five-week histories were reconciled onto
`integration/p6-reconciled` (verified against production, gate green, 3 real fixes
recovered from dead branches) and `main` was meant to fast-forward to it. That push did
not happen. On 16 September two commits landed on `main` directly: a 191-file working
tree drop (mobile UI uplift, Google and Apple sign-in, icons, token rebrand, migrations
renumbered `0118` to `0125`, new edge functions) and an `eas.json` change.

The result today:
- `integration/p6-reconciled` has **256 commits `main` lacks**: the August security lockdown,
  the money P0 fixes, moderation, push, account deletion, grants baseline, and the fixes
  recovered on the 14th.
- `main` has **2 commits the reconciled line lacks**, carrying the UI uplift and social
  sign-in, with migration numbers that collide with `0118`, `0119` and `0120` on the
  reconciled line.
- `fix/qa-round-2026-09-15` (five tester fixes) was correctly branched from the reconciled
  line and merges cleanly.

An App Store build from today's `main` ships without the August work. So, before any
store build:

1. Abishai pushes the reconciled branch and its new commits.
2. Your two 16 September commits are re-landed onto the reconciled line as
   `prasanth/ui-uplift`, with the migrations renumbered at merge. That is one
   reconciliation session, the same shape as the 14th.
3. `main` fast-forwards to the result and every surface is redeployed from it.
4. Then the store build.

## 9. Open actions, by owner

**Abishai**
- Push `integration/p6-reconciled` (22 commits waiting locally).
- Send the GitHub write invite to `pr6760`; confirm who `p24studios` is; accept or revoke
  the pending invites for `Amaeya` and `debora462`.
- Make the repo private.
- Invite Prasanth to: Supabase org, Vercel team, Expo org (or move the project), Apple
  team and App Store Connect, Play Console, Sentry, Jira.
- Create the four `EXPO_PUBLIC_*` variables in the EAS production environment.
- Apply the pending migrations and deploy the two functions (section 3), enable pg_net.

**Prasanth**
- Stop any store build from today's `main` until section 8 is done.
- Confirm which GitHub account you push from.
- Link the five Vercel projects to the repo so `main` deploys automatically, once `main`
  is canonical.

**Recorded debt**
- `packages/types/src/db/database.types.ts` was generated with older options and lacks
  several tables (`account_deletions` and others); regenerate with
  `supabase gen types typescript --local` in its own commit.
- The mobile Courts click-out on `venues.booking_url` (the affiliate model for courts) is
  not built yet; the column and admin entry are.
