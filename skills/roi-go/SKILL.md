---
name: roi-go
description: Implement ROI plans in the product repo — wave-ordered delivery, oracle execution, and substantive evidence capture. Pair with roi:drive for lifecycle progression.
---

# roi:go — implementation driver

This skill turns ROI plans into real code, tests, and verification evidence.
It owns one stage: **read plans → implement actions → run oracles → record
evidence**. It is the **work loop** (edit repo → run gates →
`evidence_record`).

It does **not** replace `roi:drive`, which owns the **ROI loop** (runs,
verify gate, publication markers). `roi:drive` may invoke this skill in the
same session when implementation proof is owed.

**Pairing:** `roi:outline` → **`roi:go`** → `roi:drive`. Do not expect
`run_create` in `mode=local` to implement anything — it only records a stub
prompt. Implementation happens here.

## When invoked from `roi:drive`

When `status_get.summary.next_actions` leads with `roi:go`, treat that as
active scope:

- Use the **same `mission_id`** (and plan id / wave if drive named one).
- Prefer the **lowest wave** plan that lacks substantive verification
  evidence, unless the operator named a specific plan.
- After recording evidence, return control to `roi:drive` so verify gate
  and publish can proceed.

### Completion mode (drive-invoked, default)

When `roi:drive` invokes this skill for completion (default unless the
operator said **drive only**), do **not** stop after a single plan:

1. Read state:

   ```bash
   node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
   ```

   Inspect `mission_go_progress` (`total`, `substantive`, `open[]`) and
   `latest_run`.

2. **Loop** until `mission_go_progress.complete` is true (or the operator
   constrained a single plan / wave):

   - Pick the lowest-wave plan still lacking substantive `roi:go`
     verification **and** whose `dependencies` (plan UUIDs) already have
     substantive passes. Use:

     ```bash
     node roi/scripts/lifecycle.mjs plan_list '{"mission_id":"<id>"}'
     node roi/scripts/lifecycle.mjs evidence_list '{"mission_id":"<id>"}'
     ```

   - Implement that plan (actions → oracles → `evidence_record` with proof
     bundle).
   - Emit `→ implemented [plan] (wave N, verification pass|fail)`.
   - On oracle failure: stop with blocking plan id; do not advance to the
     next plan in the loop.

3. Emit a **completion matrix**:

   ```
   roi:go progress: {substantive}/{total} substantive passes
   open: [plan_id …] or (none)
   ```

4. Return control to `roi:drive` — drive will run reconcile (resume paused
   review tasks), reach `verify_gate` (mandatory pause), and the operator
   will run `roi:verify`.

### Strict mode (operator says strict / verified **or** brief policy is strict)

Strict applies when **any** of these hold:

1. Operator says `strict` / `verified` on `roi:drive` or sets `ROI_STRICT_VERIFY=1`.
2. `status_get.summary.verification_policy` is **`strict`** (brief carries
   `verification_policy: strict` or graduation/maturity hints — see
   [`docs/mission-verification-policy.md`](../../docs/mission-verification-policy.md)).

When strict applies, every `evidence_record` with `result: pass` must include:

- **`run_oracles: true`** — helper runs `verification_targets` and sets
  `verified_by: mcp` (legacy stamp name; means **helper-verified**).
- **`paths_touched`** under `bmo/` or `roi/`.
- Optional **`product_tree: bmo`** or **`roi`** when porcelain cross-check
  is appropriate for the plan slice.

Do not rely on agent-set `oracles_ok` alone in strict mode — the helper
overwrites oracle results when `run_oracles` is true.

Mission-level `roi:go` verification satisfies run `spec_review` /
`quality_review` stub blockers (`local_implement_stub_only`, missing stub
execution markers) when substantive proof exists for that `plan_id`.

**Agentic missions:** Read
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md).
Judge completion against each plan's `verification_targets` (oracles), not
advisory file lists.

## Input dispatch

Resolve input in this priority order:

1. **Mission ID** — if known from context, use it.
2. **Outline artifact** — `.json` from `plan_generate` / `roi:outline`.
   Call `status_get`, then `plan_list` to load stored plans; use the
   artifact only to confirm wave order or CE bundle ids.
3. **Inline Plan text** — Plan-mode output from Codex, Copilot, Claude
   Code, Cursor, CE, or Markdown. Call `plan_normalize` with
   `stage:"go"`, persist returned plans with `plan_generate` after
   `roi:outline` quality checks, then execute the stored ROI plans. Do not
   record `roi:go` evidence against unpersisted external Plan text.
4. **Brief or requirements file** — `.md` / `.txt` CE plan or maturity doc.
   Extract goal and constraints; `mission_list` for a match, else
   `mission_create` + `brief_revise`. If no plans yet, run `plan_generate`
   once, then continue.
5. **Goal string** — `mission_list` for title match; confirm reuse with
   operator when ambiguous. Else `mission_create`.

When input is omitted, use the mission ID from the previous turn.

## State-read before act

Always start with:

```bash
node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
```

Require at least one plan (`plan_list`); if none, call `plan_generate` or
stop with next action `roi:outline`.

Note `latest_run` / run-level `status` and `next_actions` so evidence can
be attached to an active run when one exists.

## Product workspace

Implementation targets the **product tree**, not the ROI package:

- BMO missions: edit and test under `bmo/` (`cd bmo && task test`,
  targeted `go test` per plan oracles). Never land product code at the
  workspace parent `internal/`.
- ROI-only missions: edit under `roi/` with `pnpm test` / plan oracles.
- Other repos: follow paths named in the brief, plans, or CE requirements
  doc.

## Execution order

Use the same ordering for **manual** runs and **completion mode** (do not
use wave-only selection while ignoring `dependencies`).

1. `plan_list` — load all plans with `wave`, `dependencies`, `actions`,
   `verification_targets`.
2. Sort by `wave` ascending; within a wave, respect `dependencies` (plan
   UUIDs; plans with unsatisfied deps wait).
3. **Pre-execution VT audit.** Before implementing actions, scan each
   target plan's `verification_targets` for shell-precedence-fragile or
   helper-incompatible forms (see [VT defect catalog](#vt-defect-catalog)
   below). If any VT is defective:
   - **Stop.** Do not implement, do not record evidence with the
     defective VT in the bundle.
   - Call `plan_revise` to replace the defective VT with a deterministic
     equivalent. Document the substitution in the `rationale` field of
     the revise call (e.g. "VT 3 used `||` fallback that always-runs
     under POSIX `sh`; replaced with single deterministic `go test`").
   - Re-read the plan via `plan_list` so you have the new revision
     number for the evidence bundle.

   This audit is cheap (regex-grade inspection) and prevents an expensive
   class of failures: the helper rejects evidence for a VT that *would
   have passed by hand* but is structurally broken under `sh`, forcing a
   plan_revise round-trip mid-execution. Catching it before the
   `evidence_record(run_oracles: true)` call keeps the implementation
   commit, the evidence row, and the plan revision aligned in one pass.
4. **Pre-execution source-contract audit.** If a target plan has
   `requires_source_contract_check: true` or non-empty `source_contract_refs`,
   read the referenced source artifact(s) before editing. Build a coverage
   list that maps each load-bearing source requirement to either a
   `verification_targets` entry or a manual-review proof artifact. If the
   plan's targets are too weak to cover the source contract, or if a
   coverage row would cite a target string that is not already present in the
   plan's `verification_targets`, call `plan_revise` before implementing; do
   not defer the mismatch to `roi:verify`.
5. For each plan, in order:
   - Implement `actions` in the product repo (minimal diff, match
     conventions).
   - Run every `verification_targets` entry (shell commands, builds,
     tests).
   - On failure: fix or stop and report blocking plan id + oracle output.
   - **Before `evidence_record(result=pass)`** — satisfy the
     [implementation proof bundle](#implementation-proof-bundle) below.
     Oracle exit 0 alone is not sufficient (e.g. `go test` with `[no tests
     to run]` is a **fail**).
   - On success:

     ```bash
     node roi/scripts/lifecycle.mjs evidence_record '<json>'
     ```

     With `<json>`:

     ```json
     {
       "mission_id": "<id>",
       "run_id": "<run_id_when_active_else_omit>",
       "type": "verification",
       "source": "roi:go",
       "result": "pass",
       "content": {
         "plan_id": "<plan_uuid>",
         "plan_revision": <int_from_plan_list>,
         "wave": <int>,
         "implementation_proof": {
           "oracles_ok": true,
           "diff_stat": "<from `git diff --stat`>",
           "paths_touched": ["bmo/internal/ops/ops.go", "..."],
           "oracles_run": [{"cmd":"go build ./...","ok":true}],
           "source_contract": {
             "source_refs": ["docs/plans/source-roadmap.md"],
             "coverage": [
               {
                 "requirement": "Inventory includes public_url and task_path fields",
                 "disposition": "verification_target",
                 "verification_target": "node scripts/check-inventory-contract.mjs"
               }
             ]
           }
         },
         "summary": "<one paragraph>"
       },
       "run_oracles": false
     }
     ```

   - Optional: `trace_record` with high-level events (files changed, tests
     run).

## Implementation proof bundle

Required for every `evidence_record` with `result: pass`:

| Check | Rule |
|-------|------|
| **Oracles OK** | Set `implementation_proof.oracles_ok: true` only when all `verification_targets` executed; no `[no tests to run]`; tests that add behavior must have ≥1 matching test case |
| **Actions reflected** | Non-empty product-tree `git diff` (or staged diff) **or** explicit `paths_touched` for files created/edited this session — unless the plan scope is verify-only with no implementation actions |
| **Payload** | `content.implementation_proof` records `oracles_ok`, `diff_stat`, `paths_touched`, `oracles_run` |
| **Source contract** | When the plan has `requires_source_contract_check: true` or `source_contract_refs`, include `implementation_proof.source_contract.source_refs` and `coverage[]`; `source_refs` must include every plan `source_contract_refs` path, and each `verification_target` row must exactly match one plan `verification_targets` entry; use `manual_review` or `not_applicable` with proof/reason when no persisted target covers the requirement |
| **Verify-only** | Set `verify_only_plan: true` only when the plan has **no** `actions`; the helper rejects the flag when actions exist |
| **Honesty** | Without `run_oracles`, `oracles_ok: true` means you ran every target in this session (agent-claimed). With `run_oracles: true`, the helper runs targets and owns `oracles_ok` / `oracles_run`. |
| **Trust** | Default pass is **agent-claimed** (`implementation_proof_trust: agent_claimed`). Pass `run_oracles: true` on `evidence_record` for **helper-verified** (`verified_by: mcp`, legacy stamp). |
| **Per-plan bundle** | Do not reuse the same `diff_stat` + `paths_touched` across plans; helper rejects duplicates unless `shared_bundle: true`. |

### Post-ship quality review → reopen plans

When implementation-quality or `holistic-review-remediator` finds gaps **after**
`roi:go` evidence exists, record `quality_review` before `roi:verify`:

```bash
node roi/scripts/lifecycle.mjs evidence_record '{
  "mission_id":"<id>",
  "type":"quality_review",
  "source":"holistic-review-remediator",
  "result":"reopen",
  "content":{"plan_ids":["<plan_id>"],"summary":"<gap>","remediation_commit":"<sha>"}
}'
```

Then remediate in-tree and re-run `roi:go` for reopened plans (with
`run_oracles: true` when `verification_policy` is strict).

Two trust levels:

1. You must actually run oracles and land work before `result: pass` —
   that is agent integrity, not helper enforcement.
2. The helper validates bundle shape, `plan_revision`, and (when listed)
   `paths_touched` on disk. It does **not** re-run oracles unless you set
   `run_oracles: true`.
3. `roi:drive` may advance the ROI lifecycle on substantive **claims**;
   that is not the same as "safe to merge" for external stakeholders.
   Cite git/CI outside ROI when reporting product readiness.

For **helper-verified oracles**, call `evidence_record` with
`run_oracles: true` (requires `content.plan_id`). The helper executes
every `verification_targets` entry, stores stdout/stderr in `oracles_run`,
sets `verified_by: mcp`, and rejects pass when any target fails (including
vacuous `go test` with `[no tests to run]`).

**Paths:** `paths_touched` entries must be repo-relative under `bmo/` or
`roi/` and must exist. Optional `product_tree: bmo|roi` on
`evidence_record` also requires each path to appear in
`git status --porcelain` at the workspace root.

**Verify gate:** Operators may call `verify_evaluate` with
`require_verified_proof: true` so `pass` is rejected unless run plans
already have substantive `roi:go` with `verified_by: mcp` (typically via
`run_oracles`). See `roi-verify` for that flag.

If actions are not yet reflected in the tree, record `result: fail` with
`implementation_proof_missing` in `content.summary` — do not record pass.

Do **not** call `run_create` unless the operator explicitly asks to open a
ROI run after implementation (prefer `roi:draft` or `roi:drive` for that).

## VT defect catalog

The lifecycle helper executes each `verification_targets` entry under
`execSync(cmd, { shell: true })`, which on macOS and Linux means
`/bin/sh` — POSIX sh, not bash. The helper also rejects any VT that prints
`[no tests to run]` even if its exit code is 0 (the vacuous-test guard in
`oracleRunner.mjs`). Both rules combine to surface a small set of recurring
defects in plans authored without those constraints in mind. The
**pre-execution VT audit** (step 3 of [Execution order](#execution-order))
exists to catch them before they cause a wasted helper round-trip.

Defects to flag and revise via `plan_revise`:

| # | Pattern | Why it breaks helper-verified evidence | Fix |
|---|---------|----------------------------------------|-----|
| 1 | `cd X && cmd_a 2>/dev/null \|\| cd X && cmd_b` | `&&` and `\|\|` are left-associative same precedence under `sh`. `cd X` always succeeds, so `cmd_b` always runs. If `cmd_b` is `go test ./...` the broad set will hit `[no tests to run]` and trip the vacuous-test guard. | One deterministic command. If you need conditional dispatch, make the targeted package always exist as part of the plan's actions and run the focused command unconditionally. |
| 2 | `go test -run 'Pattern' ./...` | Walks every module package; non-matching packages print `[no tests to run]`; helper marks the whole VT vacuous-fail. | Scope to the package: `go test ./internal/<pkg>/... -count=1`. Drop the `-run` filter unless you also scope the package set. |
| 3 | `rg -q 'PATTERN' --type go` (no path) | Walks the whole workspace; ambiguous repo state can pass or fail. Slow under helper timeouts. | Scope: `rg -q 'PATTERN' bmo/internal/<scope> --type go`. |
| 4 | `grep -v 'PATTERN'` / `rg -v 'PATTERN'` for absence assertions | `-v` inverts which lines are *printed*, not the exit status; the VT exits 0 even when `PATTERN` is present. | Use `! cmd`: `cd bmo && ! rg -q 'PATTERN' <scope>`. Helper sees non-zero exit when the pattern reappears. |
| 5 | `cmd 2>/dev/null` to suppress test stderr | Helper reads combined stdout+stderr for the vacuous-test guard; suppressing stderr does not change the verdict but hides diagnostics from the operator on real failures. | Drop the redirect; let stderr through. |
| 6 | `read`, `vim`, `less`, any interactive prompt | Helper runs non-interactively; prompts hang until per-VT `timeoutMs` (default 600s) expires. | Replace with non-interactive equivalent (e.g. `git diff --stat` instead of `git diff`). |
| 7 | Unquoted `rg` patterns containing shell metacharacters (`{`, `(`, `\|`, `$`) | `sh` may glob-expand or substitute before `rg` sees the pattern. | Single-quote the pattern: `rg -q 'instagrim-dev/bmo/internal/(ui\|term)' …`. |
| 8 | `$VAR` substitution | Helper environment is whatever was exported when `lifecycle.mjs` was launched; agent-set variables don't propagate. | Inline the literal value into the VT. |

When you encounter any of these in a plan you're about to execute, the
correct action is `plan_revise` *before* the implementation commit, not
"work around it in this turn." A revised plan with deterministic VTs is
durable; an inline workaround is not.

## Scope controls

- **Single plan:** operator names a plan id → implement only that plan and
  its deps; still record evidence for what ran.
- **Single wave:** operator names a wave number → only plans in that wave.
- **Resume:** if evidence already exists for a plan with `result: pass`
  **for the current `plan.revision`**, skip unless the operator requests
  rework (`roi:edit` / `plan_revise`). After `plan_revise`, prior passes
  are stale.

## Stop conditions

- All targeted plans have passing verification evidence → stop, recommend
  `roi:drive`.
- Unresolvable oracle failure → stop with plan id, command output,
  suggested `roi:edit` or brief/plan revision.
- Missing plans or empty `actions` → stop, recommend `roi:outline`.

## What roi:go does NOT do

- Does not call `verify_evaluate` (use `roi:verify` or `roi:drive`).
- Does not publish (`evidence_record` type `artifact` / handoff — use
  `roi:publish`).
- Does not auto-call `enlighten_run` (suggest `roi:learn` after a
  completed run).
- Does not refine the brief (`roi:clarify`) or modify plans
  (`plan_revise`).

## Reporting

Close with:

```
mission_id: <id>
plans_implemented_this_invocation: [<plan_id list>]
substantive_passes: <count>
open_plans: [<plan_id list>] or (none)
trust: agent_claimed | mcp_verified
next_actions: <quoted from helper output>
→ <one sentence explaining what that step does>
```

If `next_actions` is empty, say so. Do not invent next steps.
