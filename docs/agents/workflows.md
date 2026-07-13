# Agent Workflows

How each phase in docs/PLAN.md actually runs: who spins up, in what order, on what model tier, and how state passes between agents that share no memory.

## Per-phase choreography

Every phase (P0 through P8) runs the same shape. Agents are fresh spawns per phase; nothing carries over except what is written to the repo.

### 1. Planner

- Reads: docs/PLAN.md, the phase's PRD sections, the prior phase's PHASE-N-STATUS.md handoff notes, current Jira ATL board state.
- Cuts Jira stories for the phase from PRD acceptance criteria (FR-y items), one story per FR or small cluster of related FRs. Stories reference `PRD-0X FR-y` in the description, never paraphrase the requirement.
- Assigns each story to a builder track (see model tiering below) and sequences dependencies (schema before RLS before RPC before UI).
- Output: Jira stories filed under the phase's epic, plus a short docs/phases/PHASE-N-STATUS.md skeleton listing the deliverables this phase owes, unchecked.

### 2. Parallel builders

Multiple builder agents run in parallel, one per app/domain area, each scoped to a subset of Jira stories from the planner. Builders do not talk to each other directly; they coordinate only through the repo (file boundaries, packages/types, packages/theme) and through Jira ticket status.

**Model tiering:**

- **Opus tier**: schema design (Supabase migrations), RLS policies, payments (Razorpay integration, ledger writes, edge functions handling money), and anything touching the financial invariant in PLAN.md. These are the highest blast-radius surfaces; get them right the first time.
- **Sonnet tier**: screens, CRUD flows, portal pages, component composition on top of already-defined tokens and types. The bulk of feature work.
- **Haiku tier**: mechanical work — seed data, fixture generation, repetitive story-to-component scaffolding, copy pass for house style compliance, straightforward test writing.

A builder agent, on picking up a story:
- Transitions the Jira ticket to In Progress.
- Reads only what it needs: the specific PRD FR(s), packages/types, packages/theme (or the portal's token file), and any architecture doc relevant to its domain (SCHEMA.md, API-MAPPING.md, RLS.md, PAYMENTS.md, VIDEO.md).
- Builds strictly to the FR. Does not add adjacent scope even if it seems obviously useful (the biased approver will reject it).
- On completion, transitions the ticket to In Review and leaves a one-line implementation note on the ticket (what changed, which files).

### 3. Integrator

- Runs after builders report their stories done (In Review or later).
- Pulls the branch/worktree state, runs `pnpm turbo typecheck build lint` across the monorepo.
- Deploys: Vercel preview URLs for portal apps, Expo preview/dev build (or simulator build) for mobile.
- Captures light and dark mode screenshots of every screen touched this phase.
- Runs Supabase RLS advisor if migrations changed this phase.
- Writes a diff summary (files changed, one line per feature) for the biased approver.
- If typecheck/build fails, the integrator does not proceed to the approver; it kicks the failure back to the responsible builder track and waits.

### 4. Biased approver

- Spun up fresh per gate per docs/agents/biased-approver.md.
- Inputs: PRDs, PHASE-N-STATUS.md, the integrator's diff summary, build results, preview URLs, light and dark screenshots, RLS advisor output.
- Outputs APPROVE or REJECT with itemized findings (see biased-approver.md for the exact format).
- On REJECT, findings route back to the specific builder track that owns the flagged files. Builders fix, integrator re-runs, approver re-reviews. Maximum 2 cycles; cycle 3 escalates to the founder per the escalation rule in biased-approver.md.

### 5. Phase-close

- Runs only after an APPROVE (or a founder-approved override after escalation).
- Updates docs/phases/PHASE-N-STATUS.md: checks off completed deliverables, records the approver's advisory findings (even though non-blocking, they must not be lost), records what was deferred and why.
- Writes explicit handoff notes for the next phase's planner: open questions, known debt, anything the next phase needs to know that is not obvious from the code (e.g. "coach earnings RPC assumes single currency, revisit if multi-currency lands").
- Reconciles the Jira board: every story tied to this phase should be Done; anything left open gets moved to the next relevant epic or flagged to the founder if it should have been done and wasn't.
- Commits the docs updates. This is the only artifact the next phase's agents can rely on for phase history; there is no other memory.

## Crash recovery / checkpoint protocol

Integration passes are long, touch remote state (Supabase migrations, edge function deploys) that a local `git revert` cannot undo, and run in an environment where the agent session can crash or be killed mid-pass. This is a permanent rule for every phase's integrator, not a one-off from any specific phase.

- **Commit after every discrete, independently-meaningful integration step**, not once at the end of the phase. A step is commit-worthy the moment it is independently true and would be expensive to re-derive: one migration applied to the remote project, one edge function deployed, `pnpm turbo typecheck build lint` going green, an advisor run completing with a recorded verdict. Do not batch a whole phase's remote actions into a single end-of-phase commit; if the session dies between step 3 and step 4, a single batched commit means step 3's work is invisible to the agent that resumes.
- **Maintain a scratch log at `docs/phases/PHASE-N-CHECKPOINT.md` for the duration of an in-flight phase.** Record exactly what has landed (which migration versions are applied remotely and their returned version ids, which edge functions are deployed and their status, whether build/lint is green, whether advisors have been run and their verdict) versus what is still pending. Write to it as you go, not retroactively.
- **A resumed or freshly-spawned agent reads the checkpoint file plus `git log` before doing anything else**, and treats any step already recorded there as done, not to be repeated (re-applying an already-applied migration or re-deploying an already-deployed function wastes time at best and risks a version collision at worst). This is the same "write it down or it didn't happen" principle the rest of this doc applies to phase memory, scoped down to single-phase, in-progress granularity.
- **The checkpoint file's job ends when the phase closes.** Phase-close folds `PHASE-N-CHECKPOINT.md`'s content into `PHASE-N-STATUS.md` (a "History" section is a reasonable place for it) and then deletes the checkpoint file. `PHASE-N-STATUS.md` is the only artifact that persists across phases; the checkpoint file is working memory for one phase's resumability and should not accumulate as permanent clutter once that phase has a real status doc.

## Context hygiene rules

- **Fresh agents per phase.** No agent identity or conversation persists across phases. Every agent in phase N+1 starts cold and reconstructs context entirely from repo docs.
- **Shared state lives only in repo docs.** PLAN.md, the PRDs, docs/design/DESIGN-LANGUAGE.md, docs/architecture/*, docs/phases/PHASE-N-STATUS.md, and Jira are the only channels between agents. Do not rely on an agent "remembering" a decision from an earlier session; if it is not written down, it did not happen.
- **Phase-close always writes handoff notes.** This is not optional. A phase that ends without an updated PHASE-N-STATUS.md handoff section has not actually closed, regardless of what the approver said.
- **Builders read narrowly.** A builder scoped to Courts inventory does not need to read the Clutch PRD. Reading only what is needed keeps agents fast and keeps them from picking up scope that was never assigned.
- **No agent edits another agent's in-flight files without a story reassignment in Jira.** If a builder discovers a bug in another track's territory, it files a ticket or leaves a note; it does not silently patch across boundaries.

## Token awareness guidance

- Planners and phase-close agents read broadly (PRDs, prior status docs) but write compactly. Status docs and handoff notes should be checklists and short notes, not prose essays; the next cold agent has to re-read all of it.
- Builders should load only the PRD sections and architecture docs relevant to their assigned stories, not entire PRD files when a section reference will do. Cite section anchors in tickets so the next agent can jump straight there.
- The biased approver reads the most (full PRDs, full diff, all screenshots) because its entire job is comprehensive judgment; do not try to save tokens on the approver by summarizing evidence. Give it the real screenshots and the real diff.
- Prefer diff summaries over full file dumps when handing work between agents (planner to builder, builder to integrator). Point at file paths and line ranges; do not paste whole files into shared docs.
- Keep PHASE-N-STATUS.md itself lean: checklist plus short handoff notes. If it starts accumulating long narrative history, move that history into a dated note or the phase's Jira epic description instead, and leave the status doc as the current-state snapshot.
