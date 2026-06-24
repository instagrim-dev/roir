# Mission verification policy

Missions declare how much trust `roi:go` and `roi:verify` require. Policy is
derived from the **latest brief revision** — not from operator memory or chat.

## Policies

| Policy | How set | `roi:go` pass | `verify_evaluate(pass)` |
|--------|---------|---------------|-------------------------|
| **default** | Absent hint, or `verification_policy: default` | Agent-claimed proof allowed (`oracles_ok` + diff/paths) | `require_verified_proof` optional |
| **strict** | `verification_policy: strict`, or graduation/maturity hints (see below) | **`run_oracles: true` required** on every pass | **`require_verified_proof` auto-on** unless `allow_partial_verification` |

`status_get.summary` surfaces:

- `verification_policy` — `default` | `strict`
- `requires_helper_verified_proof` — boolean mirror of strict

## Auto-strict hints

When no explicit `verification_policy:` line exists, the helper promotes to
**strict** if any brief `constraint` or `problem` matches:

- `graduation_mode:`
- `A-grade` / `a-grade-domain`
- `Ax→5` / `Ax->5`
- `maturity iteration` / `maturity_iteration`
- `row a closure`

Maturity-iteration and graduation missions should still set
`verification_policy: strict` explicitly in `roi:clarify` so intent is durable.

## Per-plan proof distinctness

The helper rejects `roi:go` verification passes that reuse the **same**
`diff_stat` **and** `paths_touched` as another plan in the mission unless
`implementation_proof.shared_bundle: true` is set intentionally (shared
omnibus commit).

Prefer plan-scoped `paths_touched` and unique `diff_stat` summaries per unit.

## Post-ship quality review

After code lands but before `roi:verify`, implementation-quality or holistic
remediation may find gaps. Record them without rewriting history:

```bash
node roi/scripts/lifecycle.mjs evidence_record '{
  "mission_id": "<id>",
  "type": "quality_review",
  "source": "holistic-review-remediator",
  "result": "reopen",
  "content": {
    "plan_ids": ["<plan_id>"],
    "summary": "REQ-MAT-107 site/mdbook gap after U7",
    "remediation_commit": "<sha optional>"
  }
}'
```

`result: reopen` invalidates substantive `roi:go` status for listed plans when
the reopen is the **last** go-or-reopen event for that plan (chronological
order by evidence `captured_at`, then evidence `id` when timestamps tie).
`mission_go_progress` reopens; `next_actions` returns to `roi:go` until re-verified.

After remediation lands, re-run affected plans with **`run_oracles: true`** on
strict missions, then `roi:verify`.

## Operator overrides

| Goal | Action |
|------|--------|
| Force strict | Add `verification_policy: strict` in `roi:clarify` |
| Allow agent-claimed on a graduation mission | Add `verification_policy: default` **after** explicit operator decision (overrides hints) |
| Drive strict without brief edit | `roi:drive strict` or `ROI_STRICT_VERIFY=1` (operator session; brief policy still governs helper blocks) |

See also: [`command-reference.md`](./command-reference.md) (`roi:go`, `roi:verify`),
[`skills/roi-go/SKILL.md`](../skills/roi-go/SKILL.md).
