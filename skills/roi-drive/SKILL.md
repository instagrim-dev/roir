---
name: roi-drive
description: Assisted or autonomous ROI lifecycle driver — advances the ROI loop; when implementation is owed, continues via the roi:go workflow in the same invocation, then verify and publish. Does not edit the product repo.
---

**ROI lifecycle driver:** reads mission state and **advances the ROI loop**
(plans → **implement stage (`roi:go` workflow)** → runs → verify → publish).
It does **not** edit the product repo or run repo tests.

When implementation proof is missing, stale, or non-substantive, drive
**advances into the go stage** — it does not stop at “please run `roi:go`.”
`status_get.next_actions` leading with **`roi:go`** is the signal to **execute
the `roi:go` skill** for this mission (same invocation), then **re-enter
`roi:drive`** after evidence exists.

**Agentic missions:** When the brief or plan originated from CE / maturity
requirements, read [`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md).
At `verify_gate`, judge **properties and oracles** against recorded evidence,
not stub `LOCAL_EXECUTION_COMPLETED` output from `run_create` in `mode=local`.

## Recommended pairing

```
roi:outline  →  roi:go  →  roi:drive
```

`roi:drive` alone may create a run that pauses at `verify_gate` with no
implementation evidence — treat that as a signal to run `roi:go`, not as
completion.

## Input dispatch

Resolve input in this priority order:

1. **Mission ID** — if a mission ID is known from the current context, use it.
2. **Brief file path** — if a `.md` or `.txt` file path is given, extract the
   problem framing, assumptions, constraints, and success criteria from it
   (use common heading conventions as hints; synthesize free-form content when
   headings are absent). Call `mission_create` with the extracted title and
   goal, then `brief_revise` with the extracted fields.
3. **Goal string** — free text. Check `mission_list` for a mission with a
   matching title; if found, confirm with the operator before reusing. If none,
   call `mission_create` with the goal as the title.

When the operator omits explicit input, use the mission ID established in the
previous turn.

## Precedence

1. **Explicit operator constraint** — phrases like “drive only”, “lifecycle
   only”, or “do not implement” mean: run lifecycle MCP steps only; **do not**
   invoke the `roi:go` workflow even when `next_actions` leads with `roi:go`.
2. **Strict verify (D7-w3)** — phrases like “strict”, “verified drive”, or
   `ROI_STRICT_VERIFY=1` mean: compound `roi:go` must record MCP-verified proof
   (`run_oracles: true` on each pass) and `verify_evaluate(pass)` must set
   `require_verified_proof: true`. Optionally add **`run_oracles: true`** on
   verify to re-run plan targets at the gate (D2-D). Incompatible with **drive only**.
3. **Default (this skill)** — when the go stage is owed, **continue via `roi:go`**
   in the same invocation (see [Compound actuation](#compound-actuation-default-v0112)).

## State-read before act

After resolving the mission ID, always call `status_get(mission_id)` first.
Use the returned `summary` to determine current lifecycle position before
taking any action.

## Drive to completion (default v0.1.3)

Unless the operator constrained **drive only**, one `roi:drive` invocation
should advance the mission toward **published / terminal** state using this
pipeline (LFG-shaped, ROI-native):

```
status_get
  → [work loop] while implementation owed: roi:go completion mode (all open plans)
  → [run reconcile] while latest run paused (not verify_gate): run_resume
  → [verify] verify_gate: evidence review → verify_evaluate
  → [publish] evidence_record(artifact) on pass
  → terminal summary (or roi:learn when completed)
```

**Work loop:** When `next_actions` starts with **`roi:go`** or
`mission_go_progress.complete` is false, execute **`roi:go` completion mode**
(see `roi-go` skill) — implement every in-scope plan lacking substantive proof,
not only the first. Re-call `status_get` after the loop.

**Run reconcile:** When a run is **paused** at `spec_review` or
`quality_review` but mission-level substantive `roi:go` exists for that plan,
call **`run_resume(run_id)`** — the service re-queues paused review tasks and
re-evaluates with roi:go satisfaction. Repeat until the run reaches
`verify_gate` or a non-go blocker remains.

**Verify gate:** Only after substantive `roi:go` evidence exists for in-scope
plans (same rules as [Compound actuation](#compound-actuation-default-v0112)).
In [strict verify mode](#strict-verify-mode-d7-w3), call
`verify_evaluate(run_id, verdict, notes, require_verified_proof: true)` for
`pass` — MCP rejects pass unless run plans have `verified_by: mcp` go evidence.

**Stop (honest):** If `roi:go` blocks on an oracle, external auth, or policy —
emit summary with blocker and **do not** call `verify_evaluate(pass)`.

**Terminal contract:** Stop with publication marker recorded, or with explicit
`next_actions` the operator must run (`roi:go`, `roi:edit`, human unblock). Do
not claim mission complete while `mission_go_progress.complete` is false.

**Trust (D7/D8):** Terminal summary must reflect `status_get.implementation_proof_trust`:

- **`agent_claimed`** — say **ROI lifecycle complete (agent-claimed proof)**.
- **`mcp_verified`** — say **ROI lifecycle complete (MCP-verified oracles for in-scope plans)**.

Do not say product work is externally proven (git/CI/human) — that remains outside ROI.

## Dispatch

Dispatch on the last run's status (or on `no runs yet`):

**No runs yet (or no plan)**
→ Call `plan_generate(mission_id)` if no plan exists. The response returns a
  `plans` array; use `plans[0].id` as the `plan_id` for `run_create`.
→ Call `evidence_list(mission_id)`. If implementation proof is still owed
  (`next_actions` will lead with `roi:go` after `status_get`), follow
  [Compound actuation](#compound-actuation-default-v0112) — do not call
  `verify_evaluate(pass)` or `run_create` until `roi:go` completes for the
  open plan slice.
→ Otherwise call `run_create(mission_id, plan_id, mode=local)`.
→ Emit `→ run created`. Continue to self-review if paused at gate.

**Run paused at `verify_gate`**
→ Triggered when the run-level status is `paused` and `next_actions` contains
  `roi:review`. (The individual verify_gate task may show `status: input_required`
  — use run-level status, not task-level status, as the dispatch signal.)
→ Read `status_get` evidence: review `trace_count`, `evidence_count`, and
  `review_records`. Inspect evidence via `evidence_list(mission_id, run_id)`.
→ For each plan id in scope, judge only the **latest** `source: roi:go`
  verification row (newest `created_at`); ignore stale pass/fail from earlier runs.
→ Ignore stub-only evidence whose body is only `LOCAL_EXECUTION_COMPLETED` from
  local `implement` tasks — that is not implementation proof.
→ If substantive verification evidence is missing, follow
  [Compound actuation](#compound-actuation-default-v0112) (do not call
  `verify_evaluate` until `roi:go` evidence exists).
→ For each `roi:go` verification with `result: pass`, confirm
  `content.implementation_proof` exists (diff and/or `paths_touched`) and
  oracles were not vacuous. Treat pass without proof as **not substantive** —
  recommend **`roi:go`** rework, not `verify_evaluate(pass)`.
→ Form an explicit verdict (`pass`, `partial`, `fail`, or `inconclusive`)
  based on the evidence. Your reasoning belongs in the `notes` field.
→ Call `verify_evaluate(run_id, verdict, notes)` — add
  `require_verified_proof: true` when [strict verify mode](#strict-verify-mode-d7-w3)
  is active and `verdict` is `pass`.
  - **`pass`** → call `evidence_record(mission_id, type=artifact, ...)` to
    record the publication marker, then emit the final summary and stop.
  - **`partial` or `fail` (resolvable issues)** → call `plan_revise` to
    address the blocking issues, then `run_create` to start a new run. If
    the re-evaluate verdict is still non-pass, surface to the operator and
    stop. **One edit retry per `roi:drive` invocation.**
  - **`fail` (external blockers)** → surface the blocking issues to the
    operator immediately and stop.

**Compound actuation (default v0.1.2)**

Triggered when `status_get.summary.next_actions` **starts with `roi:go`**
(implementation proof owed for at least one in-scope plan).

→ Emit `→ implementation stage (roi:go)`.
→ **Continue this invocation** by executing the **`roi:go` skill** in
  **completion mode** for the same `mission_id` (all open plans unless the
  operator named a single plan or wave). In **strict verify mode**, `roi:go`
  must use `evidence.record` with `run_oracles: true` on every `pass` (see
  `roi-go` strict-drive section).
→ Emit `→ roi:go complete` with `mission_go_progress` (or `→ roi:go blocked`
  with reason).
→ **Re-enter `roi:drive`** on the same mission: call `status_get` again, then
  [run reconcile](#drive-to-completion-default-v013) (`run_resume` when needed),
  then verify gate / publish.
→ Do **not** call `run_resume`, `verify_evaluate(pass)`, or `plan_revise` in
  place of `roi:go` when proof is still owed.
→ If the operator constrained **drive only**, skip the `roi:go` workflow and
  emit summary with **next: `roi:go [mission_id]`** only.

**Run paused (other reason)**
→ When `next_actions` does **not** lead with `roi:go`, call `run_resume(run_id)`.
→ Emit `→ run resumed`. Continue dispatching.

**Run running**
→ Call `run_resume(run_id)` to attempt advancement.
→ Emit `→ run advancing`.

**Run completed or mission published**
→ Emit the final summary.
→ Suggest `roi:learn` to detect reusable patterns. Do not call
  `enlighten_run` automatically.

**Run blocked or cancelled**
→ Surface the reason to the operator and stop. Suggest `roi:cancel` or a
  fresh `run_create` depending on the blocking reason.

## Strict verify mode (D7-w3)

Use when the operator wants the verify gate to accept only **MCP-verified**
implementation proof, not agent-claimed bundles alone.

**Activate when any of:**

- Operator says **strict**, **verified drive**, or **mcp verified drive**
- Environment `ROI_STRICT_VERIFY=1`

**Contract (same invocation as default drive):**

| Stage | Strict behavior |
|-------|-----------------|
| **`roi:go` completion loop** | Every `evidence.record` pass: `run_oracles: true` + valid `paths_touched` under `bmo/` or `roi/`; set `product_tree: bmo` when work is under `bmo/` and porcelain cross-check is desired |
| **Re-read** | `status_get` — expect `implementation_proof_trust: mcp_verified` when all in-scope plans substantively pass with MCP oracles |
| **`verify_evaluate(pass)`** | `require_verified_proof: true` (blocks pass if any run plan lacks `verified_by: mcp` substantive go) |
| **Terminal summary** | Use MCP-verified wording (see [Trust](#drive-to-completion-default-v013)) |

**Stop (honest):** If strict mode is on but `implementation_proof_trust` stays
`agent_claimed`, do not call `verify_evaluate(pass)` — emit blocker:
re-record go evidence with `run_oracles: true` or fix failing oracles.

## Configurable stop

By default, `roi:drive` is autonomous at the verify gate: it self-reviews when
substantive evidence exists and advances without pausing. If the operator says
"stop at the review gate" or "pause for my approval", pause after
`verify_evaluate` returns the verdict and report it for human input before
continuing.

## Progress reporting

After each MCP call, emit one line:

```
→ [step name]   (e.g., → mission created, → plan generated, → run created, → verified pass)
```

On stop, emit a concise summary:
- Mission ID
- Final state
- What changed (steps executed)
- Whether `roi:go` ran in this invocation and whether `roi:drive` re-entered
- Recommended next action only when **drive only** was requested or `roi:go` blocked

## New-mission fast path (ROI setup only)

When starting from a goal string or brief file with no existing mission:

```
mission_create → brief_revise → plan_generate
```

Execute in one pass without pausing between steps. Report `→ step name` after
each. Then either run **compound actuation** (`roi:go` when proof is owed) or
continue with `run_create` only when the operator asked for full lifecycle in one
invocation and substantive implementation evidence already exists.
