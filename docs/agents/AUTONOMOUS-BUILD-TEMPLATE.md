# Autonomous Multi-Agent Build Template

A repeatable pattern for taking a build from "requirements" to "shipped" using fresh, memory-less agents per phase, with a human gate only where it actually matters. Generalized from this project's `workflows.md` + `biased-approver.md` so it can be dropped into any new project.

## 1. Core idea

No agent instance persists across the whole build. Every phase spins up cold agents that know nothing except what's written in the repo. That's a feature, not a limitation: it forces every decision, deviation, and piece of context into a durable artifact instead of into someone's head (or a chat transcript that dies when a laptop closes). The repo *is* the memory.

## 2. Artifacts you set up once, before any agent runs

| File | Purpose |
|---|---|
| `docs/PLAN.md` | The single source of truth: phases, gates, locked decisions, schema/domain breakdown, OSS choices, risks. Anything not written here didn't happen. |
| `docs/prd/*.md` | One PRD per major surface/stakeholder. **The PRD is the ceiling, not the floor** — anything an agent builds must trace to a specific requirement in here. |
| `docs/design/TASTE.md` + `docs/design/DESIGN-LANGUAGE.md` (or equivalent style bible) | House style rules an approver agent can check mechanically: naming conventions, tokens-only styling, banned patterns, copy rules. |
| `docs/architecture/*.md` | Domain-specific deep docs (schema, API mapping, payments/financial invariants, etc.) that builder agents read narrowly — not the whole plan. |
| `docs/agents/workflows.md` | The choreography doc below, written down so it's re-derivable, not just remembered. |
| `docs/agents/biased-approver.md` | The gate-review agent's exact prompt: checklist + required inputs + output format. Written once, reused at every gate. |
| `docs/phases/PHASE-N-STATUS.md` | One per completed phase: deliverables checklist, deviations, known debt, and — critically — handoff notes for the next phase's planner. |
| A ticket tracker (Jira/Linear/etc.) | External system of record for task-level state, reconciled against status docs at each phase close. |

## 3. Per-phase choreography

Every phase runs the same five-step shape:

1. **Planner** — reads `PLAN.md`, the phase's PRD sections, the prior phase's status-doc handoff notes, and current ticket-tracker state. Cuts tickets from PRD acceptance criteria (one ticket per requirement or small cluster), assigns each to a builder track, sequences dependencies (schema before policy before API before UI).
2. **Parallel builders** — one agent per app/domain area, scoped to a ticket subset. They don't talk to each other directly; they coordinate only through the repo and ticket status. **Model tiering** (this is the leverage point):
   - **Highest tier** (opus-class): schema design, security policies, payments/financial logic, anything touching a stated financial or safety invariant. Highest blast radius — get it right once.
   - **Mid tier** (sonnet-class): screens, CRUD flows, composition on top of already-defined types/tokens. The bulk of the work.
   - **Low tier** (haiku-class): mechanical work — seed data, fixtures, scaffolding, copy passes, boilerplate tests.
3. **Integrator** — pulls the branch, runs the full build/lint/typecheck, deploys previews, captures screenshots, runs any security/policy advisors, writes a diff summary. **If the build is red, it does not proceed** — it kicks back to the responsible builder track.
4. **Biased approver** — a fresh agent spun up per gate, reading only the approver prompt + PRDs + status doc + integrator's diff/build/screenshots. Outputs `APPROVE` or `REJECT` with itemized, PRD-cited findings. On reject, findings route back to the owning builder track. **Cap fix cycles (2 is a good default)** — cycle 3+ escalates to the human, it doesn't loop forever.
5. **Phase-close** — runs only after approval. Updates the phase status doc, writes explicit handoff notes for the next phase, reconciles the ticket tracker (done tickets -> Done, undone -> flagged), and commits. **A phase without an updated status doc has not actually closed**, regardless of what the approver said.

## 4. Where the human actually gets pulled in

Not every phase needs you. Decide up front which phase gates are **founder gates** (you personally verify a real end-to-end flow — a payment, a login, a purchase) versus **automated gates** (an agent verifies hands-on in a browser/simulator and that's sufficient). Write this decision into `PLAN.md` per phase so agents know whether to wait for you or self-certify and continue. The rule of thumb: gate on anything irreversible, money-touching, or first-of-its-kind; let the pipeline self-certify routine phases.

## 5. Crash recovery / checkpoint protocol

This is the part that matters once a build runs unattended for hours. Long-running autonomous phases die mid-flight — laptop sleeps, process gets killed, session times out. Two rules prevent losing work:

- **Checkpoint-commit, don't batch.** Integrators (and any agent doing a sequence of external-effect steps — applying a migration, deploying a function, calling a paid API) commit to git after *each individual step*, not once at the end of the phase. If the process dies after step 4 of 7, you've lost nothing before step 4.
- **Keep a running scratch log during in-flight phases**: `docs/phases/PHASE-N-CHECKPOINT.md`, appended to after every step with exactly what landed. A resumed session reads this file plus `git log` and knows precisely where to pick up — no re-deriving state, no re-running steps that already succeeded. Fold its contents into `PHASE-N-STATUS.md` and delete it once the phase actually closes; its only job is bridging an interruption mid-phase.

## 6. Context hygiene (keeps cold agents fast and correct)

- Builders read narrowly — only the specific PRD section and architecture docs their ticket touches, never the whole plan.
- Status docs and handoff notes are checklists, not essays. The next cold agent has to re-read all of it every time; don't make it wade through prose.
- The approver is the one agent that should read *everything* (full PRDs, full diff, real screenshots) — don't summarize evidence away from the one role whose entire job is judgment.
- No agent silently edits another's in-flight territory. A cross-track bug becomes a ticket or a note, not a silent patch.

## 7. Orchestration mechanics (how to actually run this)

- Use a workflow/orchestration tool that supports sequential phases with named agent calls per step (planner -> builders in parallel -> integrator -> approver -> close), so each stage's output feeds the next as plain text/data, not shared memory.
- Between phases, use a self-pacing wakeup/loop mechanism so the pipeline advances autonomously without you polling it — it should only interrupt you at the founder gates you defined in step 4.
- Model-tier your agent calls explicitly per step (don't default everything to your biggest model — that's slow and expensive for mechanical work, and wastes real capability on schema/payments if you under-tier those instead).

## 8. Adapting this to a new project — checklist

1. Write `PLAN.md`: phases, one gate criterion per phase, which gates are founder-gates.
2. Write PRDs for each major surface, cut to explicit acceptance criteria.
3. Write a style/taste doc if the product has strong opinions worth mechanically enforcing.
4. Write the approver prompt once, checklist-driven, citing the PRDs/taste doc.
5. Write `workflows.md` documenting the five-step choreography and the checkpoint protocol above — do this before the first phase runs, not after the first crash.
6. Stand up a ticket tracker project/board and decide the ticket-cutting granularity (one per acceptance criterion is a good default).
7. Kick off phase 1 with a planner agent and let the shape repeat.
