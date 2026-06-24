---
name: roi-verify
description: Evaluate a run at its verify gate and record a verdict. Single source of truth for whether a run's evidence satisfies the brief.
---

# roi:verify — verdict at the verify gate

This skill records a verification verdict for a run paused at `verify_gate`.
It owns one stage: **read evidence → judge against criteria → record verdict
→ next-step pointer**.

The verdict is one of:

- `pass` — evidence satisfies the brief's success criteria. Mission may
  proceed to `roi:publish`.
- `partial` — some criteria met, others outstanding. Run does not advance to
  publish; operator must `roi:edit` or `roi:go` for the missing slice.
- `fail` — evidence contradicts criteria, or critical oracles failed.
- `inconclusive` — evidence is incomplete or unverifiable from this session.

**Boundary:** this skill does not modify plans or evidence. It only records
a verdict on what already exists. To re-record evidence, use `roi:go`.

**Agentic missions:** Verdicts must cite **falsified or satisfied properties**
(acceptance criteria / `verification_targets`), not "touched every file in
the plan." Read
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md).

## Inputs

1. **Mission ID** required.
2. **Run ID** required — the run currently paused at `verify_gate`.
3. **Optional flags** — see Flags table below.

## Procedure

1. Read mission state and the run's evidence:

   ```bash
   node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
   node roi/scripts/lifecycle.mjs evidence_list '{"mission_id":"<id>","run_id":"<run_id>"}'
   ```

2. For each plan in scope, judge the **latest** `source: roi:go`
   verification row (newest `captured_at`; `created_at` only on legacy rows);
   ignore stale pass/fail from earlier runs. Ignore stub-only evidence whose
   `LOCAL_EXECUTION_COMPLETED` from local `implement` tasks — that is not
   implementation proof.

3. For each `roi:go` verification with `result: pass`, confirm
   `content.implementation_proof` exists (diff or `paths_touched`) and that
   oracles were not vacuous (no `[no tests to run]`). Treat pass without
   proof as **not substantive** — the verdict should be `partial` or `fail`,
   not `pass`.

4. Form an explicit verdict and write reasoning into `notes`. The notes
   field is the durable record of why this verdict was recorded.

5. Persist:

   ```bash
   node roi/scripts/lifecycle.mjs verify_evaluate '<json>'
   ```

   Where `<json>` includes:

   ```json
   {
     "run_id": "<run_id>",
     "verdict": "pass",
     "notes": "All in-scope plans show substantive roi:go evidence; success criteria 1-3 satisfied per oracle output.",
     "require_verified_proof": false,
     "run_oracles": false,
     "allow_partial_verification": false
   }
   ```

## Flags

| Flag | When to use |
|------|-------------|
| `require_verified_proof: true` | Verdict `pass` is rejected unless every run plan has substantive `roi:go` with `verified_by: mcp` (set by recording evidence with `run_oracles: true`). Use when the gate must accept only helper-verified proof. |
| `run_oracles: true` | Helper runs each run plan's `verification_targets` at the gate and stamps `content.verify_gate.verified_by: mcp`; pass is rejected if any target fails. Independent of `roi:go`'s own oracle runs. |
| `allow_partial_verification: true` | **`verdict: pass` only.** Checkpoint pass when ≥1 run plan has substantive `roi:go` but the mission is incomplete. Stamps `verify_gate.partial_mission`; `next_actions` stay `roi:go`/`roi:inspect` (no `roi:publish`). With `run_oracles`, only **substantive** plans' targets run. |

Read `status_get.summary.partial_verification_eligible` before choosing
checkpoint pass vs full pass.

## Trust model

The lifecycle helper distinguishes two trust levels for `roi:go` evidence:

- **`agent_claimed`** (default) — agent says oracles passed; helper validates
  bundle shape but does not re-run.
- **`mcp_verified`** — helper executed every `verification_targets` entry
  and owns the result. Set by `evidence_record` with `run_oracles: true`,
  or `verify_evaluate` with `run_oracles: true` at the gate.

When `status_get.summary.verification_policy` is **`strict`**, `verify_evaluate(pass)`
auto-requires `mcp_verified` go evidence (same as `require_verified_proof: true`).
Cite `verification_policy` and `implementation_proof_trust` in `notes`.

**Post-ship review:** if `quality_review` with `result: reopen` lists a plan
and is the **last** reopen-or-go event for that plan (chronological order by
`captured_at`, then evidence `id`), treat the mission as **not verify-ready**
until remediation is re-go'd (`partial` or `fail` with explicit plan ids).

`status_get.summary.implementation_proof_trust` reflects which level applies
to in-scope plans.

## What this skill does NOT do

- Does not implement (`roi:go`).
- Does not modify plans (`plan_revise`).
- Does not publish (`roi:publish` does that on a passing verdict).
- Does not auto-advance — the next stage is named in `next_actions` after
  the verdict is recorded.

## Reporting

Close with:

```
mission_id: <id>
run_id: <run_id>
verdict: <pass|partial|fail|inconclusive>
trust: <agent_claimed|mcp_verified>
next_actions: <quoted from helper output>
→ <one sentence explaining what that step does>
```

On `pass`, `next_actions` typically leads with `roi:publish`. On `partial`
or `fail`, with `roi:edit` or `roi:go`. If the bridge sentence wants to
disagree with `next_actions`, surface that to the operator rather than
silently overriding.
