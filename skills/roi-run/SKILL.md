---
name: roi-run
description: Create or resume an ROI run and surface any orientation admission pause.
---

# roi:run — run lifecycle

This skill creates or resumes a run on a plan. It owns one stage:
**create or resume run → report status → next-step pointer**.

A run is the executable instance of one or more plans. It may pause at an
implementation or review task when task-bound orientation is missing; after all
workflow tasks are reconciled, it pauses at `verify_gate` for the operator-owned
verdict.

## Inputs

1. **Mission ID** required.
2. **Plan IDs** — use one or more stored IDs with `plan_ids` for `run_create`.
   Omit only when intentionally running the mission's selected/default plan set.
3. **Run ID** required for `run_resume`.
4. **Mode** for `run_create`:

   | Mode | Behavior |
   |------|----------|
   | `local` | Stub implement (`LOCAL_EXECUTION_COMPLETED`); pair with **`roi:go`** for real repo work. |
   | `agent` | Host handoff (`AGENT_IMPLEMENT_HANDOFF`); run pauses until **`roi:go`** + `run_resume`. |
   | `a2a` | Remote delegation via agent card URL (set `a2a_agent_card_url`). |

## Procedure

To create:

```bash
node roi/scripts/lifecycle.mjs run_create '{"mission_id":"<id>","plan_ids":["<plan>"],"mode":"local"}'
```

To resume:

```bash
node roi/scripts/lifecycle.mjs run_resume '{"run_id":"<run_id>"}'
```

The legacy singular `plan_id` form remains accepted only as a one-plan alias.
When both forms are supplied, they must identify the same single plan.

### Orientation Admission Pause

If the helper returns `blocking_reason: orientation_refresh_required`, do not
describe the run as being at `verify_gate`.

- `implement` task: invoke `roi:go` for this mission and run. It refreshes the
  task-bound implementation/verifier checkpoints, records `roi:go` evidence,
  then returns control to the lifecycle.
- `spec_review`, `quality_review`, or `verify_gate` task: invoke `roi:verify`.
  It lists the run tasks, refreshes the exact open verifier task checkpoints,
  and records the verdict/reconciles the open review stages.

Re-read `status_get` after that stage. Call `run_resume` only when its returned
`next_actions` or task state calls for it; do not resume from a stale snapshot.

To cancel an in-flight run, see [`roi-cancel`](../roi-cancel/SKILL.md).

Report task state, trace references, evidence, blocking reason, and
`next_actions`. If the run pauses at `verify_gate`, say so explicitly and point
to `roi:verify`; otherwise report the actual orientation admission task.

## What this skill does NOT do

- Does not implement (`roi:go`).
- Does not record verdicts (`roi:verify`).
- Does not auto-resume — the operator decides when to call `run_resume`
  (or runs `roi:drive`, which will resume when appropriate).

## Reporting

```
mission_id: <id>
run_id: <id>
mode: local | agent | a2a
status: <status>
next_actions: <quoted from helper output>
→ <one sentence>
```
