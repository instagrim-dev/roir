# Command Reference

This document describes the user-facing ROI command surface. The
editorial command layer sits on top of the stable ROI lifecycle helper
(`scripts/lifecycle.mjs`) and `ROIService`.

**Two naming registers:** ROI uses product commands (`roi:work`) and
wire underscore verbs (`mission_create`) for the same operations. This
page is the packaged mapping for those registers. For host-specific
setup, see [`installation.md`](./installation.md).

**Skill picker:** In Claude Code, Codex, and Copilot CLI, product
commands surface as `$roi-drive`, `$roi-go`, etc. in the skill picker
after running `scripts/install-agent-skills.sh <host>`. In Cursor, the
commands are recognized via `.cursor/rules/roi-commands.mdc` vocabulary
injection.

**Known constraints:** Deferred surfaces and behavioral limitations are
tracked in [`limitations.md`](limitations.md). Read it before treating
any ROI command as production-hardened.

## Naming map (product ↔ lifecycle verb)

The lifecycle helper exposes snake_case verbs (for example
`mission_create`, `enlighten_run`). Skills shell to the helper with
`node scripts/lifecycle.mjs <verb> '<json-args>'`; the verb registry is
the canonical surface (`node scripts/lifecycle.mjs --list-verbs`).

`plan_normalize` is the non-persistent intake seam for inline Plan text from
Codex, Copilot, Claude Code, Cursor, CE, or plain Markdown. It returns draft
ROI `plans` plus a `brief_patch`; the invoked skill must still persist with
`brief_revise` or `plan_generate` before execution. When inline text has no
explicit validation lines, returned plans intentionally have empty
`verification_targets` and `requires_verification_targets: true` so
`roi:outline` can add runnable gates.

Some commands are a **direct** wrapper over one primary verb. Others
are **compound skill-layer flows** that orchestrate multiple verbs
against the same durable ROI state.

| Product / docs | Primary lifecycle verb(s) | Notes |
|----------------|---------------------------|-------|
| **`roi:work`** | `mission_create` | Direct |
| **`roi:brief`** | `brief_get_latest`, `brief_revise` | Direct two-step |
| **`roi:source`** | `research_record`, `research_list`, `research_summarize` | Direct multi-verb |
| **`roi:outline`** | `plan_generate`, `plan_revise`, `plan_list` | Direct multi-verb; convergence missions may also seed a seam manifest here |
| **`roi:plan`** | (alias for `roi:outline`) | Alias |
| **`roi:draft`** | `run_create`, `run_resume`, `run_cancel` | Direct lifecycle control; may pause for task-bound orientation before `verify_gate`. Follow the returned current task and `next_actions`. |
| **`roi:review`** | `status_get`, `review_list`, `verify_evaluate` | Compound quality gate |
| **`roi:edit`** | `status_get`, `plan_revise`, `run_create`, `run_resume` | Compound revision loop |
| **`roi:publish`** | `status_get`, `evidence_record` | Compound handoff / release step; convergence missions finalize parent progress here |
| **`roi:learn`** | `enlighten_run` | Direct |
| **`roi:cancel`** | `run_cancel` | Direct; cancels a run and all its pending tasks |
| **`roi:inspect`** | `status_get` | Direct read-only |
| **`roi:go`** | `status_get`, `plan_list`, (agent repo work), `evidence_record`, optional `trace_record` | Implementation driver — orchestrates repo work and evidence; not a single verb |
| **`roi:drive`** | `status_get`, `orientation_list`; delegates other verbs to their stage skills | Thin lifecycle orchestrator; pauses at verify and publish gates |
| **Orientation checkpoint** | `orientation_refresh`, `orientation_invalidate`, `orientation_get`, `orientation_list` | Required execution/verification binding; every executor and automatic review/verifier stage binds its concrete task |

### Orientation lifecycle verbs

```bash
node scripts/lifecycle.mjs orientation_refresh '{"mission_id":"<id>","plan_id":"<plan-id>","plan_revision":3,"run_id":"<run-id>","plan_identity":"<plan-id>@3","live_state_identity":"git:<sha-or-tree-id>","current_unit":"<declared action>","next_action":"<declared action>","action_class":"implementation","proof_obligation_ids":["PO1"],"proof_targets":["<persisted verification target>"],"checked_preconditions":["<precondition>"],"observed_owner_seam_ids":["OS1"],"reason":"pre_mutation"}'
node scripts/lifecycle.mjs orientation_invalidate '{"checkpoint_id":"<checkpoint-id>","trigger":"verifier_command_invalidation","reason":"quality review reopened proof"}'
node scripts/lifecycle.mjs orientation_get '{"checkpoint_id":"<checkpoint-id>"}'
node scripts/lifecycle.mjs orientation_list '{"mission_id":"<id>"}'
```

Planning orientation is required before execution and uses
`owner_seam_coverage_and_material_uncertainty` as its completion basis. Refresh
execution orientation immediately before every host mutation and verification
orientation immediately before each verifier. Plan revision, compaction,
handoff, material live-tree change, failed mutation, verifier-command
invalidation, owner-seam disappearance, and unavailable execution capability
are the canonical invalidators.

Counts, percentages, scores, and `ContextPack.freshness_ttl` are telemetry only.
They do not establish orientation sufficiency or checkpoint eligibility.

## `roi:work`

Purpose:
Open the mission and seed the first working brief.

Typical outputs:
- new mission ID
- first brief revision
- next action: usually `roi:brief`

## `roi:brief`

Purpose:
Revise the brief with assumptions, constraints, audience, success criteria, and
non-goals.

Typical outputs:
- new brief revision
- clearer scope
- next action: usually `roi:source` or `roi:outline`

## `roi:source`

Purpose:
Gather and persist source material, findings, tradeoffs, and recommendations
that the outline and draft will rely on.

Typical outputs:
- durable research records
- source list or source summary
- next action: usually `roi:outline`

## `roi:outline`

Purpose:
Turn the brief and source material into a structured outline or execution plan
with explicit dependencies, waves, and review targets.

Convergence missions may also use `roi:outline` to materialize a declared seam
manifest. Each seam becomes one executable plan snapshot, and ROI elects the
active seam with inspectable rationale.

Typical outputs:
- plan revisions
- current planning orientation with owner seams and material uncertainties
- routing decision
- next action: usually `roi:draft`

## `roi:draft`

Purpose:
Create or resume a run, expand staged tasks, and produce the draft artifact or
execution result locally or through bounded A2A delegation.

Typical outputs:
- run record
- staged tasks
- traces and evidence
- next action: usually `roi:review`

## `roi:review`

Purpose:
Evaluate the draft against the brief, recorded source material, and declared
review targets, then record a verdict.

Typical outputs:
- updated run status
- final review record for the current gate
- next action: `roi:edit`, `roi:publish`, or `roi:learn`

A full pass requires substantive `roi:go` evidence for every run plan. When
accepted, it completes queued run-scope workflow tasks, marks the run
`completed`, and suppresses stale blockers superseded by later pass reviews.
Partial checkpoint passes keep publish unavailable and leave `roi:go` in
`next_actions`. They require an explicitly named semantic scope and a current
verification checkpoint bound to the current revision and proof obligations;
every verifier verdict is additionally bound to the matching verify-gate task;
the number or fraction of substantive plans is not an eligibility rule.

## `roi:edit`

Purpose:
Respond to review findings by revising the outline, updating the draft, or
re-running bounded execution.

Typical outputs:
- revised plan or follow-on run
- updated evidence and traces
- next action: usually `roi:review`

## `roi:publish`

Purpose:
Record the handoff-ready state of an artifact, memo, plan, or deliverable for
operators and downstream readers.

For convergence missions, recording `publication` or `handoff` evidence is also
the durable backend boundary that advances parent-domain progress and re-elects
the next seam within the declared manifest.

Typical outputs:
- publication or handoff evidence
- final artifact references
- next action: usually `roi:learn`, `roi:inspect`, or `roi:draft` for the next
  active seam

## `roi:learn`

Purpose:
Detect repeated successful patterns and propose a human-gated reusable
capability. The system does not retain learning automatically — capability
proposals always require human promotion via `capability_promote`.

**Note on naming:** The wire verb name is `enlighten_run`. This is the
one verb that does not follow the standard `noun_action` pattern used by
all others. The discrepancy is a known v0.1 artifact; callers should use
`enlighten_run` (not `learn_run`) when invoking the lifecycle helper.

Typical outputs:
- detected patterns
- proposed capabilities (status `proposed`; not auto-promoted)
- `noop` when fewer than 3 successful activations exist (this is expected, not
  an error)
- next action: `capability.promote` when a proposal exists

## `roi:cancel`

Purpose:
Cancel an in-flight or paused run and all its pending tasks and activations.
The mission and plan remain intact; start a new run with `roi:draft` when ready.

Typical outputs:
- cancelled run record
- count of tasks and activations transitioned to `cancelled`
- next action: `roi:draft` (new run on the same plan) or `roi:inspect`

## `roi:go`

Purpose:
Execute ROI plans in the product repository — wave-ordered implementation,
`verification_targets` oracles, and verification evidence on the mission (and
active run when present). This is the **work loop**; it does not call
`verify_evaluate` or publish.

Pass a mission ID, outline JSON, requirements `.md`, or goal string. Requires
plans (`plan_list`); use `roi:outline` first when none exist.

Typical outputs:
- `→ implemented [plan]` lines per completed plan
- `evidence_record` entries with `source: roi:go`, `implementation_proof`
  (`oracles_ok`, plan-scoped diff / `paths_touched`)
- recommended next action: `roi:drive` or `roi:review`

The lifecycle helper enforces `result: pass` for `source: roi:go` verification evidence
(requires `implementation_proof.oracles_ok: true` plus diff or paths). By
default that proof is **agent-claimed** (`implementation_proof_trust:
agent_claimed`). Pass **`run_oracles: true`** on `evidence_record` (with
`content.plan_id`) so the helper executes `verification_targets`, fills
`oracles_run`, and stamps `verified_by: mcp` (legacy stamp name; means
**helper-verified**; surfaces as `implementation_proof_trust: mcp_verified`).
`paths_touched` must use logical `bmo/` or `roi/` prefixes and resolve to
real files in the active workspace / package layout; set
**`product_tree`** (`bmo`|`roi`) for an optional git porcelain cross-check.
For plans with `requires_source_contract_check: true` or non-empty
`source_contract_refs`, passing `roi:go` evidence must also include
`implementation_proof.source_contract.source_refs` and `coverage[]` rows
that map each source requirement to a verification target, manual-review
proof, or explicit not-applicable reason. `source_refs` must include every
plan `source_contract_refs` path, and `verification_target` coverage rows must
exactly match persisted plan `verification_targets`. Manual-review evidence
must cite an inspectable proof artifact; local repo-relative evidence paths must
exist when the helper can resolve them.
At verify gate, pass **`require_verified_proof: true`** on
`verify_evaluate` to require `mcp_verified` go evidence for the run's
plans (default false), or **`run_oracles: true`** to have the helper run
`verification_targets` at verify time and stamp `content.verify_gate`
(blocks `pass` if targets fail; D2-D). For high-stakes source-derived
missions, pass **`require_independent_source_contract_review: true`** to require
`source_contract_proof_confidence: independent_reviewed` before `pass`.
For incremental missions,
**`allow_partial_verification: true`** with **`verdict: pass`** records a
checkpoint pass only for a semantically coherent scope explicitly named by
non-empty `scope_plan_ids`, with current
plan revisions, substantive scope-bound proof, source-contract coverage, and a
current verification checkpoint. It stamps `verify_gate.partial_mission`, keeps
`roi:go` in `next_actions`, and does not imply publish readiness. Use
`verdict: partial` when the verify-gate task should stay incomplete.
`status_get.summary.partial_verification_eligible` and its counts are telemetry;
they cannot make an incoherent or stale scope eligible.
See `docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`
(D7, D8).

See `skills/roi-go/SKILL.md` for dispatch detail.

## `roi:drive`

Purpose:
Drive the **ROI lifecycle** from any position by reading `status_get` and
orientation state, then delegating to the stage skill named by `next_actions`.
It does not edit the product repo, record evidence, or record verdicts itself.
When implementation proof is missing and the operator did not say `drive only`,
it invokes `roi:go` only for plans covered by current planning orientation,
then re-enters drive after evidence exists. It stops at `verify_gate` and
`publish_gate` for explicit operator judgment.

**Strict mode:** operator says `strict` / `verified drive`, sets
`ROI_STRICT_VERIFY=1`, or brief `verification_policy` is **strict** (graduation /
maturity missions) — delegated `roi:go` uses `run_oracles: true`; the operator's
later `roi:verify` uses `require_verified_proof: true`. See
[`docs/mission-verification-policy.md`](./mission-verification-policy.md).

Typical outputs:
- one `→ step name` progress line per lifecycle helper invocation
- final summary: mission ID, final state, steps executed, recommended next action
- operator prompt when implementation or external blockers remain

## `roi:inspect`

Purpose:
Read the current mission control view without mutating state. Use at any
point in the lifecycle — not only after publication.

Typical outputs:
- mission summary
- latest brief and outlines
- convergence controller state, active seam, and active plan when present
- tasks and runs
- trace and evidence counts (for full lists use `trace.list` / `evidence.list`)
- review records
- learning readiness
- next actions

## Lifecycle notes

- **`roi:go`** implements plans; **`roi:drive`** advances ROI state and may
  chain `roi:go` when proof is missing. Recommended: `roi:outline` →
  `roi:drive` (compound go) or `roi:outline` → `roi:go` → `roi:drive`.
- Use granular skills below when you want step-by-step control of either loop.
- `roi:work` opens the mission. `roi:brief` refines it. `roi:source` records
  research material. `roi:outline` generates the plan.
- `roi:draft` does not finish a green-path mission by itself; it typically
  pauses at the review gate (`verify_gate` task stage).
- `roi:review` is the decision point that turns a paused draft into an edit,
  publish, or learn path.
- A full `roi:review` pass reconciles run task bookkeeping only after every
  run plan has substantive `roi:go` proof; old failed review rows stay in
  history but no longer appear as active blockers after a later pass supersedes
  them.
- `roi:edit` may repeat multiple times before publication.
- **`roi:learn`** is valuable only after repeated successful runs. A `noop`
  result is expected early in a mission's life and is not an error.
- **`roi:inspect`** is a read-only view available at any lifecycle stage, not
  only as a terminal step.
- **`roi:cancel`** cancels the run and all its pending tasks in one call. The
  mission and plan are preserved; a new run can be started immediately with
  `roi:draft`.
- **Hand-authored capabilities:** operators can register capabilities directly
  without going through `roi:learn` by calling `capability_register` against
  the lifecycle helper. This path has no dedicated product command alias but
  is fully supported by the backend.
