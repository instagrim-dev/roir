# State And Artifacts

ROI is built around durable artifacts instead of transcript-only state.

## State Location

By default, ROI stores its SQLite database here:

```text
.data/roi.sqlite
```

The database is created automatically by the server on first access.

## What Persists

ROI persists these categories of information:

- missions and mission status
- brief revisions
- plan revisions
- planning, execution, and verification orientation checkpoints
- orientation refresh and invalidation events
- convergence controllers and seam manifests
- runs and staged tasks
- routing decisions
- capability activations
- review records
- policy decisions
- traces and evidence
- detected patterns
- proposed and promoted capabilities

## Revision-Safe Artifacts

ROI does not treat changing state as destructive overwrite where avoidable.

- briefs are revisioned
- plans are revisioned
- orientation checkpoints bind an exact plan revision and live-state identity
- capabilities are revisioned
- review outcomes are stored as records

That means ROI can preserve how a mission changed over time instead of only
showing the latest prompt or summary.

## Orientation Checkpoint Semantics

Planning orientation is required before execution. Its authority comes from
owner-seam coverage, material-uncertainty disposition, live-state identity, and
checked execution preconditions. It never comes from a fixed number of reads,
plans, files, evidence rows, completed tasks, or elapsed time.

Planning orientation is persisted on the plan through `plan_generate` or
`plan_revise`. `orientation_refresh` appends a refresh event and persists a
current execution checkpoint; `action_class` distinguishes implementation,
review autofix, remediation, generated-artifact update, commit preparation,
verifier execution, and verifier recovery. `orientation_get` reads a checkpoint
by id; `orientation_list` exposes filtered checkpoint history.
`orientation_invalidate` marks a checkpoint stale or blocked without deleting
its history.

Execution checkpoints are refreshed immediately before every host mutation.
Verification checkpoints are refreshed immediately before each verifier or
oracle, including repeated verifiers in the same run. A `verify_evaluate`
checkpoint also binds the matching verify-gate task, and every verdict requires
that task-bound authority. Each checkpoint records the latest observed evidence
sequence; a review/verifier checkpoint older than the run's latest passing
`roi:go` evidence is stale for admission even if no explicit invalidation row
has yet been appended. Each current checkpoint
binds plan id/revision, live-state identity, current unit, exact next action,
proof obligation, owner-seam ids, checked preconditions, and its refresh event.

The canonical invalidators are:

- `plan_identity_change`
- `compaction`
- `handoff`
- `material_live_tree_change`
- `failed_mutation`
- `verifier_command_invalidation`
- `owner_seam_disappearance`
- `execution_capability_unavailable`

`plan_revise` makes checkpoints for the prior revision stale under
`plan_identity_change`. A `quality_review` reopen invalidates every current
checkpoint binding for the affected plan under `verifier_command_invalidation`; record an
additional applicable canonical trigger when the review also proves tree drift,
owner disappearance, or unavailable execution capability. Remediation requires
a refreshed execution checkpoint, and the next review requires a separately
refreshed verification checkpoint.

A passing `roi:go` evidence row for a plan with actions requires both admitted
mutation-class history and verifier coverage after the latest invalidation.
When the row names a run, both histories bind that run's concrete implement
task; a run-level checkpoint with an empty task id cannot complete the task.
`task_transition` cannot complete service-owned workflow stages; completion is
owned by execution/review reconciliation and a full `verify.evaluate` pass.

Every executor mode is admitted through a task-bound implementation
checkpoint. Automatic spec and quality review stages are verifier actions and
require separate task-bound verifier checkpoints before they can record review
state.

Context packs retain `generated_at` and `freshness_ttl` as retrieval telemetry.
TTL expiry may prompt a fresh read, but it neither invalidates nor refreshes an
orientation checkpoint and cannot authorize or block mutation. Likewise,
`mission_go_progress` totals and open/substantive counts are telemetry-only;
semantic scope and current checkpoint bindings govern execution and partial
verification.

## Task And Run Semantics

- A `Task` is the smallest interruptible execution unit.
- A `Run` is the parent record for one execution attempt and may include
  multiple staged tasks.
- A run may pause, block, or wait on external work without losing state.
- A convergence mission may keep parent-domain state open across many runs while
  still binding only one active seam and one active plan to execution at a time.

## Common Persistent States

- `queued`
- `running`
- `input_required`
- `approval_required`
- `auth_required`
- `waiting_on_external`
- `paused`
- `completed`
- `failed`
- `cancelled`

These states are how ROI models reality. A blocked workflow should look blocked
in storage, not hidden behind a conversational summary.

Convergence missions additionally persist parent-domain states such as:

- `drafting`
- `active`
- `paused_for_judgment`
- `blocked`
- `converged`
- `residual_gap_deferred`

These states are scoped to the declared seam manifest. In v1, a convergence
outcome is honest about the manifest it evaluated rather than implying
unbounded domain discovery.

## Evidence And Traces

ROI separates:

- `Trace`
  execution events, tool usage, latency, and error signals
- `Evidence`
  output artifacts, validation material, and execution results

This lets the system reason about both how work happened and what the work
produced.

### `roi:go` verification rows (v0.1.4+)

Substantive work evidence uses `source: roi:go`, `type: verification`, and a
`content.implementation_proof` object. The lifecycle helper stamps
`content.plan_revision` from the latest plan row when `plan_id` is set.
When a plan has `requires_source_contract_check: true` or non-empty
`source_contract_refs`, the same proof object must include
`source_contract.source_refs` and `coverage[]`. The source refs must include
the plan refs, and `verification_target` coverage rows must cite persisted plan
targets; otherwise the helper does not count the row as substantive.
Manual-review coverage rows must cite inspectable evidence; local
repo-relative evidence paths must exist when the helper can resolve them.

`status_get` (mission scope) also exposes:

- `verification_policy` — `default` | `strict` (from latest brief; see
  [`mission-verification-policy.md`](./mission-verification-policy.md))
- `requires_helper_verified_proof` — true when policy is strict
- `mission_go_progress` — per-plan open/substantive counts for completion mode
  (telemetry only; not an orientation or verification sufficiency gate)
- `implementation_proof_trust` — `agent_claimed` (default) or `mcp_verified`
  when `implementation_proof.verified_by` is `mcp` (legacy stamp name; means
  helper-verified)
- `source_contract_proof_confidence` — `none`, `structural`, or
  `independent_reviewed`. Structural means the helper accepted source refs,
  coverage rows, target membership, and manual-review evidence references; it
  does not mean a fresh reviewer agreed the coverage is semantically strong.

`evidence_record` optional fields (D7):

- **`run_oracles: true`** — helper runs `verification_targets`, sets
  `verified_by: mcp`
- **`product_tree: bmo|roi`** — porcelain cross-check for `paths_touched`
  (paths must still be under `bmo/` or `roi/` and exist on disk)

**`quality_review` evidence** (post-ship remediation bridge):

- `type: quality_review`, `result: reopen`, `content.plan_ids` — invalidates
  substantive `roi:go` for listed plans when reopen is the last go/reopen
  event and invalidates their verification checkpoints under
  `verifier_command_invalidation` (see
  [`mission-verification-policy.md`](./mission-verification-policy.md))

`verify_evaluate` optional fields:

- **`require_verified_proof: true`** (D7-w3, default false) — `pass`
  blocked unless run plans have substantive `mcp_verified` `roi:go`
  evidence
- **`run_oracles: true`** (D2-D) — helper runs `verification_targets`
  for run plans; stamps `content.verify_gate`; blocks `pass` on target
  failure
- **`allow_partial_verification: true`** — a non-publishing checkpoint pass is
  allowed only with non-empty `scope_plan_ids` naming a semantic scope whose plans, proof
  obligations, plan revisions, source-contract requirements, and verification
  checkpoint are current. A nonzero substantive count is telemetry, not
  eligibility.

Trust semantics and v0.2 oracle execution are documented in
[`docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`](../../docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md).

For convergence missions, publication evidence is also the replayable boundary
that finalizes parent progress. A run may be completed before publication, but
the parent controller does not advance until publication or handoff evidence is
durably recorded.

## Enlightenment Proposals

`roi:learn` does not create capabilities from a single successful run.
Instead, it looks for repeated successful activations with passing reviews. If a
pattern qualifies, ROI creates a **proposed** capability that still requires
human promotion.

When a convergence controller is present, learning may also write bounded
recommendation hints onto remaining seams (for example, evidence-confidence
adjustments). Those hints do not change mission policy, target maturity,
manifest membership, or blocked-versus-judgment classification.

## Schema And Migrations

ROI ships one current schema plus an append-only migration-step framework. The
policy remains deliberately small for v0.1:

- **Authoritative constants.** `defaultSchemaVersion` in
  [`src/db.mjs`](../src/db.mjs) and `ROI_SCHEMA_VERSION` in
  [`src/contracts.mjs`](../src/contracts.mjs) must move together. The
  package release versions are managed separately by the release checklist.
- **Idempotent create.** `openDatabase` runs `migrate()` on every start.
  `migrate()` uses `CREATE TABLE IF NOT EXISTS` for every table and then
  runs the ordered migration-step map, and stamps `roi_meta.schema_version`
  only after those steps succeed. Running it against an unchanged schema is a
  no-op.
- **Forward steps only.** `migrationSteps` is keyed by target schema version.
  Shipped steps are append-only; ROI does not provide down migrations. Schema
  v3 adds `orientation_checkpoints` through the idempotent baseline, so an
  existing database acquires the table on its next open without rewriting
  historical blobs.
- **JSON blob shielding.** Most row-shape evolution happens inside the
  `data_json` columns, which means many product-level changes do not require
  any SQL change. The `schema_version` field stamped on each record
  (`ROI_SCHEMA_VERSION`) is the version of the in-blob shape at the time of
  insert.

### Reset vs. Migrate Policy

| Change type | Example | Required action |
|---|---|---|
| **Additive table** | New `capability_proposals` table. | None for existing DBs. `CREATE TABLE IF NOT EXISTS` picks up the new shape on next start. |
| **Additive JSON field** | New field inside `briefs.data_json`. | None. Readers default missing fields; `schema_version` inside the blob identifies legacy rows. |
| **Additive SQL column with safe default** | New non-null column on `missions`. | Add an ordered migration step and a from-prior-version test, or prefer a JSON field. |
| **Breaking SQL change** | Column removed, primary key changed, table renamed. | Add an explicit forward migration with preservation tests. If preservation is not supported for this local release, declare the break and use the reset recipe below. |
| **Contract-only change** | Zod schema in `contracts.mjs` tightens a field. | Bump `ROI_SCHEMA_VERSION`; existing rows still load if the tightened field is permissive on read. Add a contract test. |

Historical v2 plans do not contain `planning_orientation`, and historical runs
do not contain immutable `plan_refs`. ROI reads and reports those records, but
execution and successful verification fail closed: revise the plan with a
current planning orientation and create a new run. ROI does not infer a plan
revision for an old run because that would erase the authority boundary the v3
contract introduces.

### Migration Discipline

Every non-idempotent schema change must add the next target-version step in
`migrationSteps`, preserve the shipped steps unchanged, and prove opening a
fixture stamped at the prior version. A schema-version bump without either an
idempotent additive baseline change or an ordered step is not migration-safe.
Reset remains an explicit local recovery option, not the default migration
mechanism.

## Resetting Local State

Stop any running lifecycle helper invocations before deleting the SQLite
files. Deleting them while a helper invocation is mid-write is not
supported and may leave a partially-written WAL.

```bash
# Default path (run from roi/ or a shell with ROI_SQLITE_PATH set).
rm -f .data/roi.sqlite .data/roi.sqlite-wal .data/roi.sqlite-shm
```

The `-wal` and `-shm` sidecar files exist because the helper opens the
database with `PRAGMA journal_mode = WAL`. Removing only `roi.sqlite` and
leaving the sidecars can cause SQLite to recover stale state on the next
helper invocation; always remove the trio together.

If you are pointing at a non-default path via `ROI_SQLITE_PATH`, apply the
same pattern to that path and its `-wal` / `-shm` siblings.
