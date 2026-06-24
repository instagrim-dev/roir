---
name: roi-clarify
description: Refine the latest brief with constraints, success criteria, assumptions, and non-goals. Creates a new brief revision; prior revisions remain durable.
---

# roi:clarify — refine the brief

This skill enriches the brief that `roi:start` seeded. It owns one stage:
**read latest brief → refine → persist new revision → next-step pointer**.

Briefs are revision-safe: each `brief_revise` call creates a new revision
without overwriting prior ones. Calling `roi:clarify` multiple times is
expected and inexpensive.

**Boundary:** this skill does not generate a plan. Plans require an outline
pass (`roi:outline`) once the brief's properties are clear. This skill also
does not refine title or goal — those live on the mission row and change via
`mission_update`.

**Read first when scoping agentic work:**
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md).
Briefs own **high-altitude** invariants and properties — not file paths,
line numbers, or test scripts.

## Inputs

1. **Mission ID** required — must reference an existing mission.
2. **Refinement source** — operator prose, a file path with constraints, or
   an existing review's blocking issues. The skill extracts:
   - **problem** — restated framing if the goal needs sharpening (default:
     keep prior revision's `problem`).
   - **constraints** — non-negotiable boundaries (cannot break X; must not
     exceed Y; runs only on Z).
   - **success_criteria** — falsifiable invariants. Prefer "agent.imports
     internal/ui returns ∅" over "tests pass."
   - **non_goals** — explicit out-of-scope items.
   - **assumptions** — what the brief takes as true without verification.
   - **open_questions** — known unresolved decisions; include enough context
     that a future executor can resolve them.
   - **audience** — who consumes the resulting work (optional).

## Procedure

1. Read the current brief:

   ```bash
   node roi/scripts/lifecycle.mjs brief_get_latest '{"mission_id":"<id>"}'
   ```

2. Compose the refined fields. Carry forward any prior values the operator
   did not explicitly change. Fields are arrays of strings (one item per
   constraint, criterion, etc.) or plain strings; see the helper output
   shape from step 1.

3. Persist the new revision:

   ```bash
   node roi/scripts/lifecycle.mjs brief_revise '<json>'
   ```

   `<json>` must include `mission_id` plus any fields you are updating.
   Output includes the new `revision` integer (revision 1 was seeded by
   `roi:start`; this call typically writes revision 2).

   For long bodies, write JSON to a temp file and use stdin:

   ```bash
   cat /tmp/brief.json | node roi/scripts/lifecycle.mjs brief_revise -
   ```

## Quality bar

| Field | Write as |
|-------|----------|
| `problem` | One paragraph naming the unresolved tension. Concrete enough that an outsider could decide if a proposed change addresses it. |
| `constraints` | Imperatives (`must not`, `must`). Each is independently checkable. Include `verification_policy: strict` on graduation / Ax→5 / maturity-iteration missions (auto-inferred if omitted, but explicit is preferred). |
| `success_criteria` | Falsifiable invariants. State the property; do not name the test that proves it. |
| `non_goals` | One bullet per excluded scope. Use to stop re-litigation in the outline pass. |
| `assumptions` | What's taken as true. If wrong, the plan is wrong — surface in `open_questions` if uncertain. |
| `open_questions` | Each must name what would resolve it (a fact, a measurement, an operator decision). **Scope-affecting open_questions are a defect** — see "Scope-decision discipline" below. |

## Evidence discipline (quantitative claims)

Any **quantitative claim** the brief carries — counts of files, imports, call
sites, test cases, lines of code, packages affected, occurrences of a pattern
— must be **evidence-grounded** at write time:

1. **Cite the command.** Run the actual `rg`, `grep`, `find`, `git log`, or
   build/test command that produced the number, and put it in the brief
   alongside the claim. Example, in `success_criteria`:

   > `core packages have zero imports of internal/ui/* (verified at brief
   > time by rg -l 'instagrim-dev/bmo/internal/ui/' bmo/internal/{app,format,uireplay,cmd,agent,agentnative,tui}/
   > => 17 lines across 9 files)`

2. **No chat-memory numbers.** A number recalled from a prior conversation,
   a previous mission, or a doc is **not** grounded. Re-derive it against
   the live tree before recording it. If you can't re-derive it now, mark
   the claim with `assumed: true` and move it to `open_questions` with the
   command that *would* resolve it.

3. **Inventories belong in `open_questions`, not `success_criteria`, until
   verified.** A brief that says "5 inward imports across 4 files" without
   a citation is a hallucinated inventory. Outline (next stage) will plan
   against it as if it were true and produce plans that miss real importers.

4. **Failure mode this prevents:** the planner reads the brief, composes
   per-plan actions and oracles scoped to the brief's named files, runs
   `roi:go`, every oracle passes, and the mission is "done" — while the
   actual invariant the brief promised (e.g. "core does not import UI") is
   still violated by sibling files the brief never named. The plan-level
   oracle was satisfied; the mission-level invariant was not.

When you cannot ground a claim, **say so explicitly** in the brief rather
than guessing precise numbers. "Several core packages still import UI
helpers (exact list TBD by `roi:outline` discovery pass)" is honest and
plannable. "5 inward imports across 4 files" without a command is a trap.

## Scope-decision discipline

`roi:clarify` owns brief readiness. A brief is ready for `roi:outline` only
when **every scope-affecting decision is resolved** — either as a
constraint (must), a non_goal (won't), or a concrete inventory entry in
`assumptions`. **Scope-affecting decisions must not survive in
`open_questions`**, because the plan is the operator-facing clarification:
if the plan can't be written without asking the operator a scope question,
the brief was not ready and the operator should not be paying that cost at
plan-execute time.

A question is scope-affecting if its answer changes:

- which files the plans touch (e.g. "is package X in-scope?"),
- which subsystems are excluded (e.g. "do we treat Y as honorary UI?"),
- which invariants the mission promises (e.g. "does the boundary apply to
  uireplay?"),
- the count of importers/callers/sites a plan must rewrite.

If any scope-affecting question remains, do **not** call `roi:outline`.
Instead, resolve it inside `roi:clarify` by:

1. **Running the discovery command** that would settle it. Most scope
   questions resolve to "what does the live tree actually contain?" Run
   the `rg` / `go list` / equivalent now and write the answer into the
   brief.
2. **Recording the decision as a constraint or non_goal**, not an
   `open_questions` item. The brief should read "X is in-scope (verified
   by command Y => N files)" or "Y is out-of-scope per operator decision
   (rationale: …)", never "Should X be in scope?"
3. **Promoting unresolvable questions** (those that genuinely require
   operator judgment, not codebase facts) to operator interaction now —
   ask once, record the answer, move on.

Open questions that legitimately remain in the brief are **non-scope**:
"Which test framework should the boundary guard use, arch_test.go vs
go-arch-lint.yml?" is fine — outline can pick based on repo conventions
without changing what the plans must do. "Is uireplay core?" is not fine —
the answer changes the plan's actions.

**Failure mode this prevents:** outline writes plans that catalog the
ambiguity ("plan 4 allowlists uireplay → ui/chat as deferred decoupling")
instead of resolving it. The plan inherits the brief's confusion. `roi:go`
runs against an unstable target, the operator gets paged at execute time,
and the mission's invariant is satisfied only by definition, not by
substance.

## Abstraction restraint

A brief that proposes a **new abstraction layer** — a new helper, type,
package, indirection, framework, coordinator, manager, registry, or
"clean boundary" the codebase did not previously contain — must treat
that abstraction as an **assumption to be falsified**, not as a load-bearing
constraint or non_goal. Models are persuasive about new structure: the
common failure is a brief that reads "introduce a `pkg/foo` coordinator
to centralize X" and then a plan that builds the coordinator before the
operator has confirmed an existing seam can't carry X. This is the
brief-time half of the **Abstraction restraint** doctrine; see
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md)
"Abstraction restraint" for the rubric scoring and `roi:outline` for the
plan-time challenge.

Rules:

1. **Survey before proposing.** A brief that proposes new structure must
   name **the existing seam considered first** and one sentence per
   reason that seam can't carry the work. "Considered: extending
   `internal/agent.Coordinator` directly. Rejected because: it owns the
   message loop and adding routing logic would couple two concerns" is
   acceptable. "Need a new coordinator to keep things clean" is not.
2. **Record new structure as `assumptions`, not `constraints`.** An
   `assumption` is something the plan must validate; a `constraint` is
   something the plan must obey. "We will add `internal/foo/`" is an
   assumption until evidence shows the existing seams can't carry the
   responsibility. Use `assumptions` so `roi:outline` knows it must
   produce a verification target that falsifies (or confirms) the
   abstraction.
3. **Falsifiable architectural invariant, not aesthetic invariant.** "The
   codebase should have clean boundaries" is not a falsifiable invariant.
   "No package outside `internal/agent/**` may import `internal/agent/internal/`"
   is. If the only justification for the new layer is aesthetic, the
   abstraction is speculative and the brief should defer it.

**Failure mode this prevents:** the brief frames a speculative
abstraction as settled scope, the plan inherits that framing as a fact,
and `roi:go` builds the layer before anyone tested whether the existing
codebase needed it. Once `internal/foo/coordinator.go` exists, removing
it costs roughly an order of magnitude more than refusing it would have.

## What this skill does NOT do

- Does not call `mission_update` (title/goal changes go via that verb directly).
- Does not generate plans (`roi:outline`).
- Does not record research findings (`roi:source`).
- Does not delete prior revisions — every `brief_revise` adds a row.

## Reporting

Close with the standard ROI Reporting block:

```
mission_id: <id>
brief_revision: <new revision number>
next_actions: <quoted from status_get output>
→ <one sentence explaining what that step does and why it follows>
```

If `next_actions` is empty, say so and stop. The lifecycle helper is the
only authority on what follows; if it disagrees with what feels right,
surface the divergence to the operator instead of silently overriding.
