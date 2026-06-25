---
name: roi-outline
description: Generate structured ROI plans with waves, dependencies, and falsifiable verification targets. One mission can have multiple plans.
---

# roi:outline — generate plans

This skill turns a clarified brief into one or more **executable plans**
with waves, dependencies, and verification targets. It owns one stage:
**read brief → generate plans → confirm storage → next-step pointer**.

A plan is what `roi:go` implements. Each plan has:

- `actions` — outcome-oriented changes the implementation must achieve.
- `verification_targets` — falsifiable oracles (commands, builds, greps)
  that prove the actions landed.
- `dependencies` — plan UUIDs this plan depends on (waits until those
  pass).
- `wave` — integer ordering for parallelizable batches.

**Read first when planning for agents:**
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md)
covers outcome strength, binding altitude, and property-style verification.

## Inputs

1. **Mission ID** required.
2. **Optional inline Plan text** — output pasted or carried in-context from
   Codex Plan mode, Copilot, Claude Code, Cursor, CE, or Markdown. Run
   `plan_normalize` first; use `normalized.plans` as the draft plan array
   after applying this skill's quality checks.
3. **Optional source artifact** — a CE plan, maturity requirements doc, or
   convergence seam manifest. When present, **import** constraints and
   properties from it; do not re-scope in ROI.
4. **Optional plans array** — when the operator already has a draft plan
   structure, pass it directly to `plan_generate`.

## Procedure

1. Read the brief and any prior plans:

   ```bash
   node roi/scripts/lifecycle.mjs brief_get_latest '{"mission_id":"<id>"}'
   node roi/scripts/lifecycle.mjs plan_list '{"mission_id":"<id>"}'
   ```

2. **Validate brief inventory against the live tree.** Before composing
   plans, re-derive every quantitative claim in the brief from the actual
   codebase. Briefs frequently undercount because they were seeded from
   chat memory or a prior mission's notes — see
   `roi-clarify` "Evidence discipline."

   For each quantitative claim in `success_criteria`, `constraints`, or
   `assumptions`:

   - Run the citation command if the brief carries one. If the brief carries
     no citation, derive one now (typically `rg -l <pattern> <scope>`).
   - Compare the live count against the brief's count. If the live tree
     reveals more importers, files, call sites, or affected packages than
     the brief named, **stop and `brief_revise`** before planning. Don't
     paper over the gap with bigger per-plan actions.
   - Inventory every importer/caller/path the plans will need to touch.
     Write them down (in the brief or in a scratch note) so the planner
     can reason about plan boundaries against an accurate footprint, not
     a stale one.

   **Why:** plans inherit the brief's inventory. If the brief says "5
   importers across 4 files" and reality is 17 across 9, the planner will
   compose actions and oracles scoped to the 4 named files, every oracle
   will pass during `roi:go`, and the mission-level invariant
   ("core does not import UI") will still be violated by the 5 unnamed
   files. The planner-stage discovery cost is O(minutes); the
   post-`roi:go` cost is O(hours) of partial-completion cleanup.

   **Stop conditions for this step:**

   - Brief carries an unsourced quantitative claim → `brief_revise` to mark
     it `assumed: true` and move it to `open_questions`, *or* derive it now
     and rewrite the brief with the citation.
   - Live tree count diverges materially from the brief → `brief_revise`
     before `plan_generate`. Document the divergence in the new revision
     so the trail is durable.
   - Brief contains no quantitative claims → skip this step.

3. **Resolve scope-affecting open_questions in the brief, not the plan.**
   Read every entry in the brief's `open_questions`. For each entry, ask:
   *would its answer change which files the plans touch, which subsystems
   are excluded, or the count of importers a plan must rewrite?* If yes,
   it is **scope-affecting** and must be resolved before `plan_generate`.

   Resolution paths (try in order):

   1. **Run the discovery command.** Most scope questions reduce to "what
      does the live tree contain?" — run the `rg` / `go list` / equivalent
      now and call `brief_revise` to record the answer as a constraint or
      non_goal. The question disappears from `open_questions` because it
      is answered.
   2. **Ask the operator once.** When the question genuinely requires
      operator judgment ("treat package X as honorary UI?"), ask once,
      capture the answer in `brief_revise`, then continue. Do **not**
      defer the question into a plan with "deferred decoupling" comments
      or allowlist entries that catalog the ambiguity.
   3. **Stop and report** if the brief is too unsettled to ground a plan.
      Returning the operator to `roi:clarify` is preferable to writing
      plans that inherit the confusion.

   **Failure mode this prevents:** plans that allowlist or comment-out
   ambiguity ("// TODO: confirm with operator whether uireplay is core")
   make the plan a catalog of unresolved scope decisions instead of an
   instruction set. `roi:go` then asks the operator scope questions at
   execute time, which is the most expensive moment to ask. The plan is
   the clarification — it must commit to a position, not list options.

   **Stop conditions for this step:**

   - At least one `open_questions` entry is scope-affecting and unresolved
     → resolve it now via discovery or operator interaction; rewrite the
     brief; **do not call `plan_generate`** until the brief no longer
     carries scope-affecting open questions.
   - All remaining `open_questions` entries are non-scope (e.g. "which
     test framework?", "which package name should we pick?") → outline
     may pick a default based on repo conventions and proceed.

4. **Challenge speculative new abstractions.** Before composing plans,
   inspect the brief and any draft plan structure for proposals to
   introduce a **new abstraction layer** the codebase did not previously
   contain — a new helper, type, package, indirection, framework,
   coordinator, manager, registry, or "clean boundary."

   For each such proposal, the brief must answer:

   1. **Which existing seam was considered first?** Name the package,
      type, or function the responsibility could plausibly attach to.
   2. **Why can't that seam carry the work?** One sentence per rejection
      reason, grounded in what the seam does today (read the file,
      not the model's prior of what the file does).
   3. **What is the falsifiable invariant the new layer enforces?**
      Aesthetic invariants ("clean boundaries," "better separation")
      are not falsifiable. Architectural invariants are
      ("no package outside `internal/agent/**` may import
      `internal/agent/internal/`").

   If the brief does not answer all three, the abstraction is
   **speculative** and must be either:

   - **Demoted to an `assumption`** in the brief (via `brief_revise`),
     so `roi:outline` can attach a verification target that falsifies
     it during `roi:go`, *or*
   - **Removed from scope** until evidence forces it.

   **Why this matters:** models are persuasive about new structure.
   "Introduce a `pkg/foo` coordinator to centralize X" reads as
   competent design but smuggles in an architectural commitment that
   the operator may not have evaluated. Once `internal/foo/coordinator.go`
   exists, removing it costs roughly an order of magnitude more than
   refusing it would have cost. The plan-time challenge is the cheapest
   place to refuse.

   **Stop condition for this step** (procedural — the agent must
   self-enforce; `plan_generate` does not reject this mechanically):

   - The brief proposes a new abstraction without answering the three
     questions above → `brief_revise` to either ground the abstraction
     (named seam considered, named falsifiable invariant) or demote it
     to an `assumption`. **Do not call `plan_generate`** with a
     speculative new layer encoded as a constraint.

   See [`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md)
   "Abstraction restraint" for the doctrine and rubric scoring.

5. **Normalize inline Plan input when present.** If the prompt/context
   includes third-party Plan text, call:

   ```bash
   node roi/scripts/lifecycle.mjs plan_normalize '{"stage":"outline","text":"<inline plan text>"}'
   ```

   Treat `normalized.plans` as draft input, not final authority. Re-check
   `actions`, `verification_targets`, waves, dependencies, abstraction
   restraint, and mission-wide oracles before `plan_generate`. If
   `confidence` is `low` or no plans are returned, stop at `roi:clarify`
   and record the missing scope instead of inventing plans. If plans are
   returned with `requires_verification_targets: true`, add runnable targets
   before persistence; do not persist prose placeholders as oracles.

6. Compose the plans. Each plan is an object:

   ```json
   {
     "name": "Hoist internal/ui/ops to internal/ops",
     "scope": "Move package and rewrite imports in agent + app",
     "actions": [
       "Move internal/ui/ops to internal/ops",
       "Rewrite imports in internal/agent/tools/ui_ops.go",
       "Confirm bmo/ builds with the new package path"
     ],
     "verification_targets": [
       "cd bmo && go build ./...",
       "cd bmo && rg -l 'internal/ui/ops' --type go | head -1"
     ],
     "dependencies": [],
     "wave": 1
   }
   ```

   The persisted plan field is `name` (not `title`). If you pass `title`, the
   service silently falls back to `Plan <index>` because the schema reads
   `requestedPlan.name`. Same for `plan_revise`.

   `dependencies` should be an array of plan UUIDs **from the same mission**.
   Because UUIDs are allocated by `plan_generate`, you cannot reference future
   plans inside a single `plan_generate` call. Either generate the upstream
   plans first and then a follow-up `plan_generate` for the dependent plan, or
   call `plan_revise` after the fact to wire dependencies once all UUIDs
   exist.

7. Persist:

   ```bash
   node roi/scripts/lifecycle.mjs plan_generate '<json>'
   ```

   `<json>` is `{"mission_id": "<id>", "plans": [<plan>, ...]}`. Output
   echoes the generated plan UUIDs and revisions.

8. Confirm storage:

   ```bash
   node roi/scripts/lifecycle.mjs plan_list '{"mission_id":"<id>"}'
   ```

9. If a plan needs adjustment after generation, use:

   ```bash
   node roi/scripts/lifecycle.mjs plan_revise '<json>'
   ```

   to create a new revision (does not overwrite the prior one).

## plan_generate quality bar

| Field | Write as |
|-------|----------|
| `name` | Short, concrete, action-led ("Hoist internal/ui/ops to internal/ops") |
| `scope` | Invariants + REQ ids / non-goals (high altitude) |
| `actions` | Observable outcomes ("emit auth_rejected from requireAuth"); not "edit foo.go line 42" |
| `verification_targets` | Runnable gates (`go test -run …`, build, grep). Each must fail when the action did not land. |
| `dependencies` | Plan UUIDs from the same mission; CE `unit.id` only when bundling |
| `wave` | Integer; lower waves run first; same wave = parallelizable |
| `actions` (abstraction restraint) | If an action introduces a new helper / type / package / coordinator / framework / boundary that didn't exist before, the brief must name the existing seam considered first and a falsifiable invariant the new layer enforces. See procedure step 4. |

## Verification target authoring discipline

Each entry in `verification_targets` is executed under
`execSync(cmd, { shell: true })` by the lifecycle helper when `roi:go`
records helper-verified evidence (`run_oracles: true`). On macOS and Linux,
that shell is `/bin/sh` — **not bash** — and POSIX `sh` is much stricter
about precedence and substitution than the interactive shell you used to
sanity-check the command by hand. A VT that "works in my terminal" can
silently misbehave inside the helper, fail evidence_record, and force a
`plan_revise` round-trip that wastes operator turns.

**Rules each VT must satisfy:**

1. **One assertion per VT.** Each VT must encode exactly one falsifiable
   check. Don't pack two checks into one command via `&&` chains where
   either side could be the failure signal — split them into separate VTs
   so the helper's per-VT `oracles_run[i].ok` precisely identifies which
   assertion failed.

2. **No `||` fallbacks across `cd`.** Constructs like
   `cd bmo && go test ./internal/foo/... 2>/dev/null || cd bmo && go test -run '...' ./...`
   look like "try the focused path, fall back to the broad path." Under
   POSIX `sh`, `&&` and `||` are **left-associative same precedence**, so
   the fallback's `cd bmo` always succeeds and the broad command **always**
   runs. The helper then sees the broad command's `[no tests to run]`
   markers and rejects the evidence as vacuous, even though the focused
   path ran fine. If you need conditional dispatch, write the VT as a
   single deterministic command. If you need a guard ("only test this if
   the package exists"), use a single shell construct that actually short-
   circuits under `sh`:
   `[ -d bmo/internal/foo ] && cd bmo && go test ./internal/foo/... -count=1`
   — note: still avoid this form; just **make the package exist** as part
   of the plan so the VT can be unconditional.

3. **No `2>/dev/null` to mask test stderr.** The helper's vacuous-test
   guard reads combined stdout+stderr; suppressing stderr does not change
   the helper's verdict but does hide diagnostic output from the operator
   when the VT does fail. Let stderr through.

4. **`go test` must run a non-empty package set.** A VT of the form
   `go test -run 'TestX|TestY' ./...` will print `[no tests to run]` for
   every package that doesn't match the run pattern; the helper marks the
   whole VT as vacuous-fail. Either scope to the package directly
   (`go test ./internal/arch/... -count=1`) or use a package set the
   helper can verify is non-empty.

5. **No interactive prompts.** No `read`, no commands that pause for user
   input. The helper runs non-interactively and any prompt will hang until
   the helper's per-VT `timeoutMs` (default 600s) expires.

6. **`rg` queries must be scoped.** A VT like
   `rg -q 'PATTERN' --type go` (no path) walks the entire workspace,
   which is slow and ambiguous — different repo states can pass or fail
   it. Scope every `rg` to the smallest directory that proves the
   property: `rg -q 'PATTERN' bmo/internal/arch --type go`.

7. **Negative VTs use `! cmd`, not `grep -v`.** When asserting absence,
   write `cd bmo && ! rg -q 'PATTERN' <scope>` so the VT exits non-zero
   when the pattern reappears. `rg -v` or `grep -v` invert which lines
   are *printed*, not which exit status is returned, and will silently
   pass when the pattern is present.

8. **Quote heredocs and patterns containing shell metacharacters.** Use
   single-quotes around `rg` patterns. Never let `$VAR` substitution leak
   into a VT — the helper has no environment beyond what's exported when
   `lifecycle.mjs` runs.

**Self-check before persisting:** for each VT you wrote, ask "if I delete
the action this VT covers, does this VT exit non-zero?" If you can't
answer yes by inspection, the VT is not falsifiable and either the action
or the VT is wrong.

## Mission-wide invariant oracles (architectural missions)

When the brief carries an **architectural invariant** — decoupling, layering,
boundary enforcement, dependency direction, package containment,
forbidden-import sets — at least one plan in the mission **must** carry a
`verification_target` that checks the **global** invariant, not just the
plan's local slice.

**Why this matters:**

A plan-local oracle scoped to one file or one package can pass while the
mission-level invariant is still violated by sibling files the plan never
named. Concrete failure mode:

- Brief invariant: "core packages do not import UI."
- Plan 2 names only `internal/app/app.go`. Its oracle is
  `! rg -q 'internal/ui/(anim|styles)' bmo/internal/app/`.
- Plan 2 lands. Oracle passes. `roi:go` records substantive verification.
- But `internal/format/spinner.go` and `internal/uireplay/dynamic.go` —
  also "core" packages outside `internal/app/` — still import the UI
  packages. The mission's invariant is violated; the plan's oracle didn't
  see it.

**The fix:** add a mission-wide invariant oracle. Either attach it to a
single plan (typically the boundary-guard plan in the highest wave) or
attach a copy to **every** wave plan so each wave's `roi:go` can detect a
regression introduced by the plan that just landed.

For the example above, the global oracle is something like:

```
! rg -q 'instagrim-dev/bmo/internal/ui/(anim|styles)' \
  bmo/internal/{app,format,uireplay,cmd,agent,agentnative,tui}/
```

…and ideally the plan also lands a **runtime** guard (a Go `arch_test.go`,
an ESLint rule, a build constraint) so the invariant is enforced beyond
the lifetime of one mission.

**Rule of thumb:** if the brief has a sentence of the form "X must not
depend on Y" or "Z must contain only W", that sentence needs a
mission-wide oracle. A plan-local oracle alone is insufficient.

**Avoid:**

- Line numbers in actions.
- Merged mega-plans that hide atomic landings.
- File laundry lists without oracles.
- Agent or team headcount prescriptions (use waves + mutual exclusion only).

When a CE plan or maturity requirements doc exists, **import** constraints
and properties from it. ROI is not the place to re-scope.

## Failure modes

- **`name` field silently dropped:** if you write `title` instead of `name`,
  the plan persists with `name = "Plan <index>"` and no error. Always read
  back with `plan_list` after generation and confirm names landed.
- **Partial-failure non-idempotency:** `plan_generate` mutates SQLite *before*
  the helper exits. If a downstream caller crashes mid-parse and you retry,
  you will end up with two batches of plans for the same intent. Recover by
  calling `plan_list`, picking one batch as canonical, and `plan_revise
  status: "superseded"` on the duplicates. Don't try to delete — there is no
  delete verb; supersession is the convention.
- **Forward dependencies impossible in one call:** plan UUIDs are allocated
  inside `plan_generate`, so a plan in the same array cannot reference a
  later plan's UUID. Either generate upstream plans first and the dependent
  plan in a second call, or call `plan_revise` after the fact to wire
  `dependencies` once all UUIDs exist.

## Convergence missions

`roi:outline` can also materialize a declared seam manifest. Each seam
becomes one executable plan snapshot, and ROI elects the active seam with
inspectable rationale. Call `plan_list` after generation to confirm the
seam-per-plan layout.

## What this skill does NOT do

- Does not implement anything in the product repo (`roi:go`).
- Does not start a run (`roi:draft`).
- Does not refine the brief (`roi:clarify`).
- Does not assign waves automatically — supply `wave` per plan.

## Reporting

Close with:

```
mission_id: <id>
plans_generated: <count>
plan_ids: [<uuid>, ...]
next_actions: <quoted from status_get output>
→ <one sentence explaining what that step does>
```

If `next_actions` is empty, say so. Do not invent next steps.
