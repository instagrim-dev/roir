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
2. **Run ID** required — the run may be paused at `verify_gate` or at an
   orientation-gated spec/quality review task.
3. **Optional flags** — see Flags table below.
4. **Current verification orientation checkpoint** — required for the exact
   semantic scope being judged, bound to current plan revisions, owner seams,
   proof obligations, source-contract requirements, and live-state identity.

## Procedure

1. Read mission state and the run's evidence:

   ```bash
   node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
   node roi/scripts/lifecycle.mjs evidence_list '{"mission_id":"<id>","run_id":"<run_id>"}'
   node roi/scripts/lifecycle.mjs task_list '{"run_id":"<run_id>"}'
   node roi/scripts/lifecycle.mjs orientation_list '{"mission_id":"<id>"}'
   ```

   Treat `partial_verification_eligible`, substantive/open counts, percentages,
   scores, and ContextPack TTL as telemetry only. None selects the verification
   scope or proves that it is sufficient.

2. For each plan in scope, judge the **latest** `source: roi:go`
   verification row (newest `captured_at`; `created_at` only on legacy rows);
   ignore stale pass/fail from earlier runs. Ignore stub-only evidence whose
   `LOCAL_EXECUTION_COMPLETED` from local `implement` tasks — that is not
   implementation proof.

3. For each `roi:go` verification with `result: pass`, confirm
   `content.implementation_proof` exists (diff or `paths_touched`) and that
   oracles were not vacuous (no `[no tests to run]`). Treat pass without
   proof as **not substantive** — the verdict should be `partial` or `fail`,
   not `pass`. Likewise, an oracle that is **under-fit** for its declared
   behavior class — one that cannot falsify the class it claims to prove (a
   smoke oracle for a refactor-equivalence or regression claim; an exact-match
   oracle for a relation-only claim), or a `verification_target` whose `proves`
   names no behavior class — is **not substantive** even when it exits 0:
   downgrade to `partial` or `fail`, not `pass`. Oracle fitness is
   reviewer-judged against the behavior-class → minimum-fit map in
   [`references/oracle-patterns.md`](../references/oracle-patterns.md); it is a
   refinement of the vacuous-proof rule above, not a separate gate.

4. For each source-derived plan (`requires_source_contract_check: true` or
   non-empty `source_contract_refs`), confirm the latest passing `roi:go`
   row includes `implementation_proof.source_contract.source_refs` and
   `coverage[]`. Each coverage row must name the source requirement and map
   it to `verification_target`, `manual_review`, or `not_applicable` with
   proof or reason. `manual_review` proof must cite an inspectable evidence
   artifact; local repo-relative evidence paths must exist when the helper can
   resolve them. `source_refs` must include the plan's `source_contract_refs`,
   and `verification_target` rows must cite an actual plan target. Treat missing
   or mismatched coverage as **not substantive** even when oracles passed.

5. For high-stakes source-derived missions, pass
   `require_independent_source_contract_review: true`. That gate blocks `pass`
   unless source-contract proof confidence is `independent_reviewed`, which
   requires explicit independent-review metadata in the `roi:go` proof bundle.

6. Before each verifier, including every target run through `run_oracles` and
   each manual review obligation, call `orientation_refresh` with
   `action_class: verifier_execution`. Bind the exact verifier, proof
   obligation/targets, current plan revision and identity, run, and the
   matching spec-review, quality-review, or verify-gate `task_id`. Refresh each
   open verifier task separately. Include live-state identity, observed owner-seam ids, and
   checked preconditions. Re-read with `orientation_get`; do not issue any
   verdict from a
   stale, blocked, missing, differently scoped, or pre-`roi:go` checkpoint.

7. Form an explicit verdict and write reasoning into `notes`. The notes
   field is the durable record of why this verdict was recorded.

8. Persist:

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
     "require_independent_source_contract_review": false,
     "run_oracles": false,
     "allow_partial_verification": false,
     "scope_plan_ids": []
   }
   ```

## Flags

| Flag | When to use |
|------|-------------|
| `require_verified_proof: true` | Verdict `pass` is rejected unless every run plan has substantive `roi:go` with `verified_by: mcp` (set by recording evidence with `run_oracles: true`). Use when the gate must accept only helper-verified proof. |
| `require_independent_source_contract_review: true` | Verdict `pass` is rejected unless source-contract run plans have `source_contract_proof_confidence: independent_reviewed`. Use for doctrine, roadmap, or other source-derived missions where same-session structural checks are not enough. |
| `run_oracles: true` | Helper runs each run plan's `verification_targets` at the gate and stamps `content.verify_gate.verified_by: mcp`; pass is rejected if any target fails. Independent of `roi:go`'s own oracle runs. |
| `allow_partial_verification: true` | **`verdict: pass` only.** Requires non-empty `scope_plan_ids` naming the non-publishing semantic scope. Every included plan must have current-revision substantive proof, required source-contract coverage, and a current verification checkpoint binding the scope's owner seams and proof obligations. Stamps `verify_gate.partial_mission`; `next_actions` stay `roi:go`/`roi:inspect`. A nonzero plan count or ratio is not eligibility. With `run_oracles`, only plans in the bound semantic scope run. |

Read `status_get.summary.partial_verification_eligible` before choosing
checkpoint pass vs full pass, but treat it only as a discovery hint. Confirm the
semantic scope and current checkpoint independently; the hint cannot authorize
a checkpoint pass.

## Trust model

The lifecycle helper distinguishes two trust levels for `roi:go` evidence:

- **`agent_claimed`** (default) — agent says oracles passed; helper validates
  bundle shape but does not re-run.
- **`mcp_verified`** — helper executed every `verification_targets` entry
  and owns the result. Set by `evidence_record` with `run_oracles: true`,
  or `verify_evaluate` with `run_oracles: true` at the gate.

On a full `pass` (not `allow_partial_verification`), the helper also reconciles
the run workflow ledger: run-scope queued/paused tasks are completed only after
every run plan has substantive `roi:go` proof, the run becomes `completed`, and
`next_actions` should lead with `roi:publish`. Stale blocking review rows are
kept in history but are hidden from `status_get.summary.blocking_issues` once a
later pass review supersedes the same review slot.

When `status_get.summary.verification_policy` is **`strict`**, `verify_evaluate(pass)`
auto-requires `mcp_verified` go evidence (same as `require_verified_proof: true`).
Cite `verification_policy` and `implementation_proof_trust` in `notes`.

**Post-ship review:** if `quality_review` with `result: reopen` lists a plan
and is the **last** reopen-or-go event for that plan (chronological order by
`captured_at`, then evidence `id`), treat the mission as **not verify-ready**
until remediation is re-go'd (`partial` or `fail` with explicit plan ids).
Invalidate the affected checkpoint with `verifier_command_invalidation` before
remediation. If the review also proves live-tree drift, owner disappearance, or
unavailable execution capability, record that canonical trigger too. A revised
plan similarly invalidates prior checkpoints under `plan_identity_change`.

`status_get.summary.implementation_proof_trust` reflects which level applies
to in-scope plans. `status_get.summary.source_contract_proof_confidence` is
`none`, `structural`, or `independent_reviewed`. Structural means the helper
accepted source refs, coverage rows, target membership, and manual-review
evidence references; it does not mean an independent reviewer agreed the
coverage is semantically strong.

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
