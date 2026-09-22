# Admin UX rebuild: status and resume point

Status: GATE 1 READY FOR THE FOUNDER (2026-09-22)
Plan: `/Users/abishaigeorgegosula/.claude/plans/snappy-foraging-meadow.md` Part B (the contract; copy the
relevant parts into `docs/PLAN-ADMIN-UX.md` at Gate 2). Direction: `docs/design/DIRECTION-ADMIN.md`.
IA: `docs/design/IA-ADMIN.md`. References: `docs/design/references/admin/stripe-*.png` (Mobbin
captures the founder supplied; no Shopify screens were supplied).

## What the founder asked for (2026-09-19, verbatim)

"The admin portal is not clear. The entire user experience, where the elements are pasted, is not
great. The whole sidebar and the whole experience of each page are not great, and the link also
doesn't really add in." On 2026-09-22: "build the best admin page so we can track everything (gear,
the affiliates with their display, filling them in, everything)."

## Where things are

| Step | State | Where |
|---|---|---|
| References | done | `docs/design/references/admin/` (PR #7 on main) |
| Tokens: typography, elevation, motion, dark `data-theme`, overlay fix, self hosted Urbanist + JetBrains Mono | done | `apps/admin/scripts/gen-tokens.ts`, `src/styles/tokens.css`, `src/main.tsx` |
| Kit: PageHeader, FilterBar, DataTable, Tabs, Badge (+`src/lib/status.ts`), Button, Field, Input, Select, Textarea, Skeleton x3, EmptyState, ConfirmDialog, Toast, SaveBar, DetailLayout, CommandPalette | done | `apps/admin/src/components/kit/`; `ui.tsx` and `form.tsx` re export so old pages compile |
| Shell: grouped sidebar, collapsible rail, sticky header with search and Cmd K, theme toggle | done | `apps/admin/src/layout/` |
| Kitchen sink `/_kitchen` (tokens, primitives twice, gear list 5 states, gear detail, gear create with SaveBar 4 states and Add from a link 3 outcomes, badges, confirm dialog open, KPI row) | done | `apps/admin/src/pages/kitchen/` |
| Captures | done | `docs/design/references/kitchen-admin-{light,dark}-{1440,1024}.png`, `kitchen-admin-shell-gear-{light,dark}.png`; script `docs/qa/evidence/admin-ux/capture-kitchen.mjs` |
| ux-critic Gate 1 | BLOCK then fixed | verdict in DIRECTION-ADMIN.md (db3c013); both findings fixed in c534c54 (sticky header, scarcity table split into available vs spent with grep output) |
| Founder Gate 1 response | OPEN | `## Gate 1 response` in DIRECTION-ADMIN.md is empty |
| Gate 2 plan doc `docs/PLAN-ADMIN-UX.md` | not started | after Gate 1 |
| Phase A1 integration (this branch onto main) | not started | branch `admin-ux/gate1-kitchen`, pushed |
| Phase A2 page rewrites (gear, venues first, then the rest) | not started | |
| Phase A3 ingest flow (draft prefills the form, per code guidance, Amazon honesty, `fetchable` flag, `RETAILER_UNAVAILABLE`) | not started | |

Gate outputs on c534c54: `tsc --noEmit` clean, `lint` 0 errors (9 pre existing warnings), `vite build`
clean, no hex in `kit/`, no `outline: "none"` added (5 pre existing hits in untouched list pages, A2 fixes
them).

## How to resume

1. Read this file, then DIRECTION-ADMIN.md fully (the verdict section names what was fixed).
2. `git fetch origin && git checkout admin-ux/gate1-kitchen` (or the worktree at
   `.claude/worktrees/agent-aa9276c0c00228baa` if it still exists).
3. Run the sink: `cd apps/admin && VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=$(supabase status -o env | grep ^ANON_KEY | cut -d= -f2 | tr -d '"') pnpm exec vite --port 5199`
   with the local stack up; login `admin@atlitos.dev` / `AtlitosDemo!2026` (local fixture); open
   `/_kitchen`. The sandbox refuses to read or write `.env*`, which is why the env is passed inline.
4. If the founder has answered Gate 1: write the answer under `## Gate 1 response`, then write
   `docs/PLAN-ADMIN-UX.md` from the plan's B3 to B8 (phases A1, A2, A3; ownership map; frozen e2e copy
   strings: "Approve and publish", "Confirm reject", "A rejection reason is required.", "Clip approved
   and published to the feed.", "This account does not have admin access."), founder gates it, then
   integrate this branch as Phase A1 (PR to main, DoD hook green, `admin.spec.ts` green against the
   preview), then A2 with builders in worktrees (Sonnet), A3 in parallel if the founder wants the link
   fix sooner.
5. If the founder has not answered: put the kitchen sink in front of them (side by side page or the
   live URL) and wait. Do not rewrite pages on an unapproved direction.

## Traps this phase hit

- Typing multi line text into a Supabase dialog submits on each newline; one URL per dialog.
- `sips -c` crops from the centre, not the top; use Playwright viewport screenshots for the top.
- Playwright resolves only from `apps/e2e` (`NODE_PATH=apps/e2e/node_modules` for scripts elsewhere).
- cmdk's `Command.Dialog` puts `className` on the inner root, use `contentClassName`.
- A builder agent stalled after ~40 minutes of a long session; small follow up fixes are cheaper done
  by the orchestrator than by resuming it.

## Related, not this phase

- OAuth providers configured and proven (PRs #5, #6, `docs/phases/OAUTH-GOOGLE-APPLE-SPEC.md`,
  `docs/qa/evidence/oauth/`). Founder still owes: Google consent screen to In production before
  8 Oct; the Apple App ID has Push Notifications unchecked.
- The seed catalogue in production (8 products, fake ASINs, tag `atlitos-21`) is still to delist.
