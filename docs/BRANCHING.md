# Branching

One line, one base. This exists because two people spent five weeks committing to two
histories that never met, and the reconciliation cost a day and produced eight duplicate
migration numbers. None of that happens if these six rules hold.

## The rules

1. **`main` is canonical and always deployable.** Every deploy of every surface comes from
   `main`. If it is not on `main`, it is not shipped.

2. **Everyone branches from `main`, and only from `main`.**
   - Prasanth: `prasanth/<topic>`
   - Agent sessions: `integration/<topic>`
   - Never branch from another feature branch. Never branch from a branch that has not
     been merged for more than a week; rebase onto `main` first.

3. **Nothing reaches `main` without the gate green.** `pnpm turbo typecheck lint` on the
   merged result, not on the branch alone. The pre-push hook runs it; do not skip it.

4. **Migrations take their number at merge time, not at branch time.** While a branch
   lives, name the file `XXXX_<name>.sql`. When it merges, rename to the next free number.
   This is the single rule that prevents the collision class we hit twice (0088 and 0107).

5. **Merge or rebase within a week.** A branch older than seven days behind `main` gets
   rebased before any new work. Long-lived branches are how divergence starts.

6. **Delete a branch when it merges.** A merged branch left alive looks like open work to
   the next person and gets audited again. `git cherry main <branch>` with no `+` lines
   means it is safe to delete.

## Checking where you stand

```
git fetch origin
git rev-list --count origin/main..HEAD     # my commits not yet on main
git rev-list --count HEAD..origin/main     # main commits I do not have (rebase if > 0)
git cherry origin/main <branch>            # '+' = genuinely unmerged content
```

## What happened on 2026-09-14

For the record, so the cost is not forgotten. `main` sat at 29 July. 275 commits of August
work existed on one laptop. Prasanth branched from the stale `main` and rebuilt account
deletion, report and block, rate limits and bounded reads a second time. The two lines had
26 conflicting files and eight migration numbers claimed by different files on each side.
Production was checked and matched the laptop line, so that became the base; his commits
were fitted onto it one by one. Full detail is in `docs/qa/CURRENT-STATE.md`.
