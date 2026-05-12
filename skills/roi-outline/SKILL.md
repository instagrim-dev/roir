---
name: roi-outline
description: Generate structured ROI outlines and plans with dependencies and review targets.
---

**Direct multi-tool:** calls `plan_generate`, then optionally `plan_list` to
confirm what was created, and `plan_revise` to adjust if needed.

**Read first when planning for agents:** [`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md) — outcome strength, binding altitude, property-style `verification_targets`.

Use `plan_generate` (logical `plan.generate`) to create one or more structured
plans. Keep actions **outcome-oriented**, dependencies explicit, and
verification targets **falsifiable oracles** (commands/gates), not test scripts.

## plan_generate quality bar

| Field | Write as |
| --- | --- |
| `scope` | Invariants + REQ ids / non-goals (high altitude) |
| `actions` | Observable outcomes (“emit auth_rejected from requireAuth”) |
| `verification_targets` | Runnable gates (`go test -run …`, build, grep) |
| `dependencies` | Prefer plan UUIDs after `plan_list`; CE `unit.id` when bundling |
| `files` (bundle only) | Advisory hints — see `fixtures/ce-plan-bundle.example.json` |

**Avoid:** line numbers, merged mega-plans that hide atomic landings, file laundry lists without oracles, agent/team headcount (see references § Execution topology — prescribe waves and mutual exclusion only).

When a CE plan or maturity requirements doc exists, **import constraints and properties** from it — do not re-scope in ROI.

After generating, call `plan_list` to confirm the plans are stored and review
their structure. Use `plan_revise` if adjustments are needed before drafting.

**Convergence missions:** `roi:outline` may also be used to materialize a
declared seam manifest. Each seam becomes one executable plan snapshot, and
ROI elects the active seam with inspectable rationale. Call `plan_list` after
generation to confirm seam-per-plan layout.

Next action: `roi:go` to implement plans, then `roi:draft` or `roi:drive` for the ROI run and verify gate.
