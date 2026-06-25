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
- capabilities are revisioned
- review outcomes are stored as records

That means ROI can preserve how a mission changed over time instead of only
showing the latest prompt or summary.

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

`status_get` (mission scope) also exposes:

- `verification_policy` — `default` | `strict` (from latest brief; see
  [`mission-verification-policy.md`](./mission-verification-policy.md))
- `requires_helper_verified_proof` — true when policy is strict
- `mission_go_progress` — per-plan open/substantive counts for completion mode
- `implementation_proof_trust` — `agent_claimed` (default) or `mcp_verified`
  when `implementation_proof.verified_by` is `mcp` (legacy stamp name; means
  helper-verified)

`evidence_record` optional fields (D7):

- **`run_oracles: true`** — helper runs `verification_targets`, sets
  `verified_by: mcp`
- **`product_tree: bmo|roi`** — porcelain cross-check for `paths_touched`
  (paths must still be under `bmo/` or `roi/` and exist on disk)

**`quality_review` evidence** (post-ship remediation bridge):

- `type: quality_review`, `result: reopen`, `content.plan_ids` — invalidates
  substantive `roi:go` for listed plans when reopen is the last go/reopen
  event (see [`mission-verification-policy.md`](./mission-verification-policy.md))

`verify_evaluate` optional fields:

- **`require_verified_proof: true`** (D7-w3, default false) — `pass`
  blocked unless run plans have substantive `mcp_verified` `roi:go`
  evidence
- **`run_oracles: true`** (D2-D) — helper runs `verification_targets`
  for run plans; stamps `content.verify_gate`; blocks `pass` on target
  failure

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

ROI ships with a **single current schema**, not a versioned migration ladder.
The policy is deliberately simple for v0.1:

- **Authoritative constants.** `defaultSchemaVersion` in
  [`src/db.mjs`](../src/db.mjs) and `ROI_SCHEMA_VERSION` in
  [`src/contracts.mjs`](../src/contracts.mjs) must move together. The
  package `version` in [`package.json`](../package.json) should be
  bumped in lockstep for any schema change (see the release checklist in
  the contribution docs).
- **Idempotent create.** `openDatabase` runs `migrate()` on every start.
  `migrate()` uses `CREATE TABLE IF NOT EXISTS` for every table and then
  stamps `roi_meta.schema_version` with the current value. Running it against
  an unchanged schema is a no-op.
- **No up/down migrations today.** `migrate()` reads the stored
  `schema_version` but does not branch on it to apply per-version SQL. Adding
  or removing columns, renaming tables, or changing primary keys is therefore
  **not** migration-safe against existing databases.
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
| **Additive SQL column with safe default** | New non-null column on `missions`. | Not supported without code support. Prefer JSON blob; if unavoidable, bump both schema-version constants and reset. |
| **Breaking SQL change** | Column removed, primary key changed, table renamed. | **Reset required.** Bump `defaultSchemaVersion` and `ROI_SCHEMA_VERSION` in lockstep, then delete the SQLite files (recipe below). |
| **Contract-only change** | Zod schema in `contracts.mjs` tightens a field. | Bump `ROI_SCHEMA_VERSION`; existing rows still load if the tightened field is permissive on read. Add a contract test. |

v0.1 ROI is **local-first**: mission data is reproducible by re-running
missions, so reset is the supported migration path for breaking changes. See
[`limitations.md`](./limitations.md#current-constraints) for the product-level
statement of this constraint.

### Future Path

If preserved history ever becomes a requirement, the intended evolution is:

1. Introduce a `MIGRATIONS` map in `db.mjs` keyed on target version.
2. Read `currentVersion` (already available in `migrate()` but unused today)
   and iterate each `(current, current+1)` step inside a transaction.
3. Only then treat `schema_version` bumps as contractually migration-safe.

Until that lands, the **reset** policy above is the honest answer.

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
