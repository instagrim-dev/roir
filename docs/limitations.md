# Limitations

ROI v0.1 is an early release with real behavior, not a production-ready
platform.

## Current Constraints

- Local SQLite is the only system of record.
- Schema changes are handled by **reset**, not a migration ladder. Breaking
  changes require bumping `defaultSchemaVersion` + `ROI_SCHEMA_VERSION` in
  lockstep and deleting `.data/roi.sqlite{,-wal,-shm}`. See
  [`state-and-artifacts.md` → "Schema And Migrations"](./state-and-artifacts.md#schema-and-migrations).
- The runtime depends on Node's experimental `node:sqlite` API.
- The package is local-first. `package.json` remains marked private to prevent
  accidental registry publishing; public source and tarball release are the
  supported distribution paths.
- The local integration files are documented for local wiring and tarball
  handoff, not remote marketplace or registry distribution.
- A2A support is bounded to task-scoped delegation and local reconciliation.
- Capability promotion is human-gated.
- The review engine is deterministic and rule-based, not model-driven.

## Two loops (v0.1)

ROI separates **work** from **lifecycle**:

| Loop | Command | Helper vs agent |
|------|---------|----------------|
| Work | `roi:go` | Agent edits the product repo and calls `evidence_record`; `run_create` in `mode=local` does **not** implement code (stub `implement` task only). |
| ROI | `roi:drive` | Agent orchestrates `run_create`, `verify_evaluate`, publication evidence. When proof is owed, drive **chains the `roi:go` skill** in the same invocation (unless the operator said "drive only"), then re-enters drive. |

`verify_evaluate(pass)` is rejected when run `plan_ids` still need substantive
`roi:go` evidence — unless **`allow_partial_verification: true`** records an
explicit **checkpoint pass** (≥1 substantive plan, mission incomplete). That is
not mission completion: `next_actions` omit `roi:publish` and
`verify_gate.partial_mission` lists open plans. **`verdict: partial`** remains
the honest label when the verify-gate task should not complete. The caller
still supplies the verdict; the helper does not re-run oracles unless
`run_oracles: true`. Full `pass` requires substantive verification evidence
for every run plan (typically from `roi:go`), not stub local implement
output. Once that full pass is accepted, the helper reconciles run-scope
workflow tasks, marks the run `completed`, suppresses superseded stale blockers
in `status_get.blocking_issues`, and exposes `roi:publish` plus `roi:learn` as
the next lifecycle actions.

`roi:go` must not record verification `pass` without an **implementation proof
bundle** (product-tree diff or `paths_touched`, plus non-vacuous oracles). See
[`docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`](../../docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md).

## Implementation proof trust (v0.1.4)

Between v0.1.4 and v0.2, all substantive `roi:go` verification rows are
**agent-claimed** proof:

| What the helper enforces | What the helper does **not** enforce (unless noted) |
|--------------------------|------------------------------------------------------|
| Payload shape (`oracles_ok`, diff or paths) | Re-running oracles without `run_oracles: true` |
| `plan_revision` match | Agent-claimed `oracles_ok` when `run_oracles` is false |
| Non-empty `oracles_run` when the plan has `verification_targets` | Semantic correctness of touched files |
| `paths_touched` exist under the active workspace root | Full CI / remote git proof (D8) |
| **`run_oracles: true` (D7-w1)** — executes `verification_targets`, stores output, sets `verified_by: mcp` (legacy stamp; means helper-verified), rejects vacuous `go test` | D2 agent-backed implement |
| **`paths_touched` under `bmo/` or `roi/`**, exists on disk (D7-w2) | Porcelain unless `product_tree` set on `evidence_record` |
| **`product_tree` on `evidence_record`** — porcelain cross-check for listed paths | |
| **`verify_evaluate(require_verified_proof: true)`** (D7-w3) — pass needs `mcp_verified` go for run plans | Opt-in via `roi:drive strict` or `ROI_STRICT_VERIFY=1` |
| Lifecycle gates (`verify_evaluate(pass)` needs go claims for run plans) | **`allow_partial_verification`** checkpoint pass (opt-in) |

`status_get.implementation_proof_trust` is `mcp_verified` when the latest
substantive go proof has `implementation_proof.verified_by: mcp`; otherwise
`agent_claimed`.

**Operator rule (D8):** ROI lifecycle completion (drive → verify → publish) means
**claims are on record and the state machine advanced** — not that product work
is externally proven. Treat **git on the remote**, **CI**, and **human review**
as the ship bar; use ROI to coordinate and gate the loop, not as a test runner
of record.

## Deferred execution (v0.2 — honest execution epic)

Not in v0.1; track here so operators do not expect drive-alone delivery:

| Capability | v0.1 | v0.2 |
|------------|------|------|
| **Implement stage** | `mode=local` stub (`LOCAL_EXECUTION_COMPLETED`); **`mode=agent`** host handoff (`AGENT_IMPLEMENT_HANDOFF` → **`roi:go`** → `run_resume`); `mode=a2a` remote | Further host automation (optional) |
| **Verify oracles** | Caller `verify_evaluate`; oracles in **`roi:go`**, **`evidence_record` `run_oracles`**, or **`verify_evaluate` `run_oracles`** (D2-D) | Tighter vacuous-oracle rejection |
| **Evidence proof** | Agent-claimed bundle + helper gates; **`mcp_verified`** when `run_oracles: true` (D7-w1–w3) | Tighter vacuous-oracle rejection |

Until v0.2: **`roi:outline` → `roi:drive`** (compound `roi:go` when needed) or
**`roi:outline` → `roi:go` → `roi:drive`** are both supported.

When implementation proof is missing for an in-scope plan, `status_get` and paused
runs surface **`roi:go` first** in `next_actions` (convergence missions skip plans tied
to already-delivered seams). **`roi:drive`** should treat that as “run the go workflow,”
not “stop and ask the operator to type `roi:go`,” unless the operator constrained
lifecycle-only behavior.

## What ROI Does Not Try To Solve Yet

- hosted multi-user coordination
- production auth and tenancy
- secrets management beyond local runtime assumptions
- enterprise policy management
- remote control-plane durability
- advanced rollout or observability infrastructure

## Security Posture

ROI should not be treated as hardened for sensitive production workloads. It is
best used for:

- local experimentation
- product and architecture exploration
- architecture prototyping
- development-time workflow exploration

## Documentation Boundary

The docs in this release aim to make the current system understandable and
usable. They do not imply that missing hardening work has already been solved.

## Deferred surface

The lifecycle helper exposes every verb currently registered in
[`scripts/lifecycle.mjs`](../scripts/lifecycle.mjs), pinned in
[`fixtures/lifecycle-verbs.json`](../fixtures/lifecycle-verbs.json). Use
[`command-reference.md`](./command-reference.md) for the packaged command
and verb mapping.

The following items are called out as intentional deferrals so the matrix
can track them without overstating completeness:

- `context_pack_create` / `context_pack_get` / `context_pack_list`: listed
  in older drafts of the surface document but not registered as lifecycle
  verbs today. Context packs are seeded implicitly by `run_create` via
  `_insertContextPack`. No direct read/list API is exposed. This file is
  the packaged tracking note for that deferral; re-registration is out of
  scope for v0.1 and should be proposed via a new plan before landing.
- `policy_evaluate`: handler uses the built-in deterministic evaluator
  (`policyEvaluator`). Policy packs, external policy engines, and
  model-driven evaluation are out of scope for v0.1. Tracking: *Current
  Constraints*, "review engine is deterministic and rule-based" row above.
- `review_record` / `review_get` / `review_list`: verdicts are derived
  from the rule-based reviewer. Dynamic rubric review and model-driven
  review are not wired. Tracking: same row as `policy_evaluate`.
- `capability_promote`: human-gated by design. Automated promotion paths
  from detected patterns are explicitly not shipped. Tracking: *Current
  Constraints*, "Capability promotion is human-gated" row above.
- `run_create` / `run_resume` in `a2a` mode: A2A execution is supported
  for task-scoped delegation and local reconciliation only. Remote
  durability guarantees and cross-host resume are not part of v0.1.
  Tracking: *Current Constraints*, "A2A support is bounded to task-scoped
  delegation and local reconciliation" row above.
- `verify_evaluate`: records the caller's verdict (default `pass`).
  Optional **`run_oracles: true`** runs plan `verification_targets` and
  stamps `content.verify_gate` (D2-D). Dynamic rubric review remains out
  of scope.
- `enlighten_run`: pattern detection requires ≥3 successful activations
  before a capability is proposed. Lowering that threshold or introducing
  adaptive thresholds is deferred. Tracking: this file.

## Canonical smoke op

[`scripts/integration-smoke.mjs`](../scripts/integration-smoke.mjs) drives
the lifecycle helper as a subprocess and uses `mission_list` as the
canonical read-only smoke assertion against a fresh temp SQLite.
`status_get` is not used because it requires an existing `mission_id` and
would need a seeded fixture to exercise.
