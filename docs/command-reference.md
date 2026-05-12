# Command Reference

This document describes the user-facing ROI command surface. The editorial
command layer sits on top of the stable ROI MCP backend.

**Three naming registers:** ROI uses product commands (`roi:work`), logical
dotted ids (`mission.create`), and wire underscore names (`mission_create`)
for the same operations. This page is the packaged mapping for those registers.
For host-specific setup, see [`installation.md`](./installation.md).

**Skill picker:** In Claude Code, Codex, and Copilot CLI, product commands
surface as `$roi-drive`, `$roi-go`, etc. in the skill picker after running
`scripts/install-agent-skills.sh <host>`. In Cursor, the commands are
recognized via `.cursor/rules/roi-commands.mdc` vocabulary injection.

**Known constraints:** Deferred surfaces and behavioral limitations are tracked
in [`limitations.md`](limitations.md). Read it before treating any ROI command
as production-hardened.

## Naming map (product ↔ MCP)

**Strict MCP `name`:** Hosts such as **Cursor** require tool names to be
`[A-Za-z0-9_]` only. The server registers **underscore** ids (for example
`mission_create`, `enlighten_run`); the MCP **title** may still show the dotted
form (for example `mission.create`) for readability. Use the **underscore**
`name` in `callTool` and agent tool pickers.

Some editorial commands are a **direct** wrapper over one primary MCP tool.
Others are **compound client-side flows** that orchestrate multiple MCP
operations against the same durable ROI state.

| Product / docs | Primary MCP tool(s) | Notes |
|----------------|---------------------|-------|
| **`roi:work`** | `mission_create` | Direct |
| **`roi:brief`** | `brief_get_latest`, `brief_revise` | Direct two-step |
| **`roi:source`** | `research_record`, `research_list`, `research_summarize` | Direct multi-tool |
| **`roi:outline`** | `plan_generate`, `plan_revise`, `plan_list` | Direct multi-tool; convergence missions may also seed a seam manifest here |
| **`roi:plan`** | (alias for `roi:outline`) | Alias |
| **`roi:draft`** | `run_create`, `run_resume`, `run_cancel` | Direct with built-in gate (typically pauses at `verify_gate`; use `roi:review` to advance) |
| **`roi:review`** | `status_get`, `review_list`, `verify_evaluate` | Compound quality gate |
| **`roi:edit`** | `status_get`, `plan_revise`, `run_create`, `run_resume` | Compound revision loop |
| **`roi:publish`** | `status_get`, `evidence_record` | Compound handoff / release step; convergence missions finalize parent progress here |
| **`roi:learn`** | `enlighten_run` | Direct |
| **`roi:cancel`** | `run_cancel` | Direct; cancels a run and all its pending tasks |
| **`roi:inspect`** | `status_get` | Direct read-only |
| **`roi:go`** | `status_get`, `plan_list`, (agent repo work), `evidence_record`, optional `trace_record` | Implementation driver — not an MCP compound; orchestrates repo + evidence |
| **`roi:drive`** | `status_get`, `mission_create`, `brief_revise`, `plan_generate`, `run_create`, `run_resume`, `verify_evaluate`, `evidence_record` | ROI lifecycle driver — runs, verify gate, publish |

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
proposals always require human promotion via `capability.promote`.

**Note on naming:** The wire tool name is `enlighten_run` (`enlighten.run`
dotted form). This is the one tool name that does not follow the standard
`noun.action` pattern used by all others. The discrepancy is a known v0.1
artifact; callers should use `enlighten_run` (not `learn_run`) when calling
via `callTool`.

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

MCP enforces `result: pass` for `source: roi:go` verification evidence
(requires `implementation_proof.oracles_ok: true` plus diff or paths). By
default that proof is **agent-claimed** (`implementation_proof_trust:
agent_claimed`). Pass **`run_oracles: true`** on `evidence.record` (with
`content.plan_id`) so MCP executes `verification_targets`, fills `oracles_run`,
and stamps `verified_by: mcp` (`implementation_proof_trust: mcp_verified`).
`paths_touched` must be under `bmo/` or `roi/` and exist; set **`product_tree`**
(`bmo`|`roi`) for an optional git porcelain cross-check. At verify gate, pass **`require_verified_proof: true`** on `verify.evaluate` to
require `mcp_verified` go evidence for the run's plans (default false), or
**`run_oracles: true`** to MCP-run `verification_targets` at verify time and
stamp `content.verify_gate` (blocks `pass` if targets fail; D2-D).
See `docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`
(D7, D8).

See `skills/roi-go/SKILL.md` for dispatch detail.

## `roi:drive`

Purpose:
Drive the **ROI lifecycle** from any position — `status_get` first, then runs,
verify gate, and publication. Does **not** edit the product repo itself; when
implementation proof is missing, **continues via the `roi:go` workflow** in the
same invocation (see `skills/roi-drive/SKILL.md` compound actuation), then
re-enters drive after evidence exists.

Autonomous by default when evidence exists: self-review at `verify_gate`, then
publish or surface blockers. One edit retry per invocation. When proof is owed
and the operator did not say “drive only”, invoke **`roi:go`** for the mission
(lowest open plan by wave) before `verify_evaluate(pass)`. Local `run_create`
implement remains stub-only (`LOCAL_EXECUTION_COMPLETED`).

**Strict mode:** operator says `strict` / `verified drive`, or sets
`ROI_STRICT_VERIFY=1` — `roi:go` uses `run_oracles: true`; `verify_evaluate(pass)`
uses `require_verified_proof: true`. See `skills/roi-drive/SKILL.md`.

Typical outputs:
- one `→ step name` progress line per MCP call
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
- `roi:edit` may repeat multiple times before publication.
- **`roi:learn`** is valuable only after repeated successful runs. A `noop`
  result is expected early in a mission's life and is not an error.
- **`roi:inspect`** is a read-only view available at any lifecycle stage, not
  only as a terminal step.
- **`roi:cancel`** cancels the run and all its pending tasks in one call. The
  mission and plan are preserved; a new run can be started immediately with
  `roi:draft`.
- **Hand-authored capabilities:** operators can register capabilities directly
  without going through `roi:learn` by calling `capability_register` (`capability.register`)
  on the MCP backend. This path has no dedicated product command alias but is
  fully supported by the backend.
