---
name: roi-go
description: Execute ROI plan implementation in the product repo — wave-ordered delivery, verification oracles, and evidence capture. Pair with roi:drive for lifecycle verify and publish.
---

**Implementation driver:** turns ROI plans into real code, tests, and
verification evidence. This is the **work loop** (edit repo → run gates →
`evidence_record`). It does **not** replace `roi:drive`, which owns the
**ROI loop** (runs, verify gate, publication markers).

**Pairing:** `roi:outline` → **`roi:go`** → `roi:drive` (or `roi:draft` →
`roi:review`). **`roi:drive`** may invoke this skill in the same session when
implementation proof is owed (see `roi-drive` compound actuation). Do not expect
`run_create` in `mode=local` to implement anything — it only records a stub
prompt. Implementation happens here.

## When invoked from `roi:drive`

When the prior step was `roi:drive` and `status_get.summary.next_actions`
starts with **`roi:go`**, treat that as active scope:

- Use the **same `mission_id`** (and plan id / wave if drive named one).
- Prefer the **lowest wave** plan that lacks substantive verification evidence
  unless the operator named a specific plan.
- After recording evidence, tell the host to **re-run `roi:drive`** on the
  mission so verify gate and publish can proceed.

### Completion mode (drive-invoked, v0.1.3)

When **`roi:drive`** invokes this skill for completion (default unless the
operator said **drive only**), do **not** stop after a single plan:

1. `status_get(mission_id)` — read `mission_go_progress` (`total`,
   `substantive`, `open[]`) and `latest_run`.
2. **Loop** until `mission_go_progress.complete` is true (or the operator
   constrained a single plan / wave):
   - `selectGoHandoffTarget` via `plan_list` + `evidence_list` — lowest wave
     plan still lacking substantive `roi:go` verification **and** whose
     `dependencies` (plan UUIDs) already have substantive passes.
   - Implement that plan (actions → oracles → `evidence_record` with proof
     bundle).
   - Emit `→ implemented [plan] (wave N, verification pass|fail)`.
   - On oracle failure: stop with blocking plan id; do not advance to the next
     plan in the loop.
3. Emit a **completion matrix**:

   ```
   roi:go progress: {substantive}/{total} substantive passes
   open: [plan_id …] or (none)
   ```

4. Return control to **`roi:drive`** — drive will `run_resume` paused review
   tasks, self-review at `verify_gate`, and publish when evidence satisfies the
   gate.

### Strict drive (`roi:drive` + strict / verified / `ROI_STRICT_VERIFY=1`)

When drive invoked with **strict verify** (see `roi-drive` strict mode), every
`evidence.record` with `result: pass` must include:

- **`run_oracles: true`** — MCP runs `verification_targets` and sets
  `verified_by: mcp`
- **`paths_touched`** under `bmo/` or `roi/` (existing D7-w2 rules)
- Optional **`product_tree: bmo`** or **`roi`** when porcelain cross-check is
  appropriate for the plan slice

Do not rely on agent-set `oracles_ok` alone in strict mode — MCP overwrites
oracle results when `run_oracles` is true.

Mission-level `roi:go` verification satisfies run **spec_review** /
 **quality_review** stub blockers (`local_implement_stub_only`, missing stub
 execution markers) when substantive proof exists for that `plan_id`.

**Agentic missions:** Read
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md).
Judge completion against each plan's `verification_targets` (oracles), not
advisory file lists.

## Input dispatch

Resolve input in this priority order:

1. **Mission ID** — if known from context, use it.
2. **Outline artifact** — `.json` from `plan_generate` / `roi:outline` (mission
   id in file or operator context). Call `status_get`, then `plan_list` to load
   stored plans; use the artifact only to confirm wave order or CE bundle ids.
3. **Brief or requirements file** — `.md` / `.txt` CE plan or maturity doc.
   Extract goal and constraints; `mission_list` for a match, else
   `mission_create` + `brief_revise`. If no plans yet, run `plan_generate` once,
   then continue.
4. **Goal string** — `mission_list` for title match; confirm reuse with
   operator when ambiguous. Else `mission_create`.

When input is omitted, use the mission ID from the previous turn.

## State-read before act

Always call `status_get(mission_id)` first. Require at least one plan
(`plan_list`); if none, call `plan_generate` or stop with next action
`roi:outline`.

Note `latest_run` / run-level `status` and `next_actions` so evidence can be
attached to an active run when one exists.

## Product workspace

Implementation targets the **product tree**, not the ROI package:

- BMO missions: edit and test under `bmo/` (`cd bmo && task test`, targeted
  `go test` per plan oracles). Never land product code at the workspace parent
  `internal/`.
- ROI-only missions: edit under `roi/` with `pnpm test` / plan oracles.
- Other repos: follow paths named in the brief, plans, or CE requirements doc.

## Execution order

Use the same ordering for **manual** runs and **completion mode** (do not use
wave-only selection while ignoring `dependencies`).

1. `plan_list(mission_id)` — load all plans with `wave`, `dependencies`,
   `actions`, `verification_targets`.
2. Sort by `wave` ascending; within a wave, respect `dependencies` (plan UUIDs;
   plans with unsatisfied deps wait — match `selectGoHandoffTarget` / MCP).
3. For each plan, in order:
   - Implement `actions` in the product repo (minimal diff, match conventions).
   - Run every `verification_targets` entry (shell commands, builds, tests).
   - On failure: fix or stop and report blocking plan id + oracle output.
   - **Before `evidence_record(result=pass)`** — satisfy the [implementation proof
     bundle](#implementation-proof-bundle) below. Oracle exit 0 alone is not
     sufficient (e.g. `go test` with `[no tests to run]` is a **fail**).
   - On success: `evidence_record` with:
     - `mission_id`
     - `run_id` — set when `status_get` shows an active or paused run; else omit
     - `type`: `verification` (or `execution_output` when logs are the artifact)
     - `source`: `roi:go`
     - `result`: `pass` | `fail`
     - `content`: `{ plan_id, plan_revision, wave, implementation_proof, summary }`
       where `plan_revision` is stamped by MCP from the latest plan row;
       `implementation_proof` includes `oracles_ok: true`, `diff_stat`,
       `paths_touched`, `oracles_run` (see bundle below)
4. Optional: `trace_record` with high-level events (files changed, tests run).

## Implementation proof bundle

Required for every `evidence_record` with `result: pass` (see
`docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`):

| Check | Rule |
|-------|------|
| **Oracles OK** | Set `implementation_proof.oracles_ok: true` only when all `verification_targets` executed; no `[no tests to run]`; tests that add behavior must have ≥1 matching test case |
| **Actions reflected** | Non-empty product-tree `git diff` (or staged diff) **or** explicit `paths_touched` for files created/edited this session — unless the plan scope is verify-only with no implementation actions |
| **Payload** | `content.implementation_proof` records `oracles_ok`, `diff_stat`, `paths_touched`, `oracles_run` |
| **Verify-only** | Set `verify_only_plan: true` only when the plan has **no** `actions`; MCP rejects the flag when actions exist |
| **Honesty** | Without `run_oracles`, `oracles_ok: true` means you ran every target in this session (agent-claimed). With `run_oracles: true`, MCP runs targets and owns `oracles_ok` / `oracles_run`. |
| **Trust** | Default pass is **agent-claimed** (`implementation_proof_trust: agent_claimed`). Pass `run_oracles: true` on `evidence.record` for **mcp_verified** (`verified_by: mcp`, D7-w1). |

### Trust model (do not over-promise)

v0.1.4 separates **recording honest claims** from **MCP-verified proof**:

1. You must actually run oracles and land work before `result: pass` — that is
   agent integrity, not MCP enforcement.
2. MCP validates bundle shape, `plan_revision`, and (when listed) `paths_touched`
   on disk. It does **not** re-run oracles unless you set `run_oracles: true`.
3. `roi:drive` may advance the ROI lifecycle on substantive **claims**; that
   is not the same as “safe to merge” for external stakeholders (D8). Cite
   git/CI outside ROI when reporting product readiness.

For **MCP-verified oracles**, call `evidence.record` with `run_oracles: true`
(requires `content.plan_id`). MCP executes every `verification_targets` entry,
stores stdout/stderr in `oracles_run`, sets `verified_by: mcp`, and rejects
pass when any target fails (including vacuous `go test` with `[no tests to run]`).

**Paths (D7-w2):** `paths_touched` entries must be repo-relative under `bmo/` or
`roi/` and must exist. Optional `product_tree: bmo|roi` on `evidence.record`
also requires each path to appear in `git status --porcelain` at the workspace
root.

**Verify gate (D7-w3):** Operators may call `verify.evaluate` with
`require_verified_proof: true` so `pass` is rejected unless run plans already
have substantive `roi:go` with `verified_by: mcp` (typically via `run_oracles`).

If actions are not yet reflected in the tree, record `result: fail` with
`implementation_proof_missing` in `content.summary` — do not record pass.

Do **not** call `run_create` unless the operator explicitly asks to open a ROI
run after implementation (prefer `roi:draft` or `roi:drive` for that).

## Scope controls

- **Single plan:** operator names a plan id → implement only that plan and its
  deps; still record evidence for what ran.
- **Single wave:** operator names a wave number → only plans in that wave.
- **Resume:** if evidence already exists for a plan with `result: pass` **for the
  current `plan.revision`**, skip unless the operator requests rework
  (`roi:edit` / `plan_revise`). After `plan_revise`, prior passes are stale.

## Progress reporting

After each plan completes:

```
→ implemented [plan title or id]   (wave N, verification pass)
```

On stop, emit:

- Mission ID
- Plans completed vs total
- Evidence ids or count (`evidence_list` summary)
- Recommended next action: `roi:drive` or `roi:review` when a run is paused at
  `verify_gate`; else `roi:draft` then `roi:review`

## Stop conditions

- All targeted plans have passing verification evidence → stop, recommend
  `roi:drive`.
- Unresolvable oracle failure → stop with plan id, command output, suggested
  `roi:edit` or brief/plan revision.
- Missing plans or empty `actions` → stop, recommend `roi:outline`.

## What roi:go does not do

- Does not call `verify_evaluate` (use `roi:review` or `roi:drive`).
- Does not publish (`evidence_record` type `artifact` / handoff — use
  `roi:drive` or `roi:publish`).
- Does not auto-call `enlighten_run` (suggest `roi:learn` after a completed run).
