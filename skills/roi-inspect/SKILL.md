---
name: roi-inspect
description: Show current ROI mission summary, draft state, traces, reviews, and learning opportunities. Read-only.
---

# roi:inspect — read-only mission view

This skill presents the current state of a mission in human-readable form.
It owns one stage: **read state → present**. Read-only; mutates nothing.

Use at any point in the lifecycle — not only after publication.
`roi:inspect` is the primary operator view for understanding current
mission state.

## Inputs

1. **Mission ID** required (or use the mission ID from the previous turn).

## Procedure

```bash
node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
```

The helper output includes:

- mission row (title, goal, state)
- latest brief revision
- plans (with revisions, waves, dependencies)
- tasks (current run's tasks)
- runs (status, paused gate if any)
- policy decisions
- routing decisions
- capability activations
- review records
- trace and evidence counts
- patterns (from `pattern_detect`)
- capability proposals (from `enlighten_run`)
- learning readiness
- convergence controller state (when present)
- `summary.next_actions` — the helper's recommended next stage

For full trace or evidence content, run:

```bash
node roi/scripts/lifecycle.mjs trace_list '{"mission_id":"<id>"}'
node roi/scripts/lifecycle.mjs evidence_list '{"mission_id":"<id>"}'
```

## What this skill does NOT do

- Does not modify state.
- Does not advance the lifecycle (`roi:drive` does that).

## Reporting

Present the state in operator-readable prose. Close with the standard
Reporting block:

```
mission_id: <id>
state: <mission state>
latest_run: <id or none>
next_actions: <quoted from helper output>
→ <one sentence explaining what that step does>
```
