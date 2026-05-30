---
name: roi-cancel
description: Cancel an in-flight or paused run, marking pending tasks and activations as cancelled.
---

# roi:cancel — cancel a run

This skill cancels a run. It owns one stage: **call `run_cancel` →
report**.

Cancelling transitions the run, all its pending tasks, and all its active
capability activations to `cancelled`. The mission and plan remain
intact — start a new run with `roi:draft` (or `roi:run`) when ready to
resume work.

## Inputs

1. **Run ID** required. Visible in `roi:inspect` output under `runs`, or in
   the most recent `roi:draft` / `roi:run` response.

## Procedure

```bash
node roi/scripts/lifecycle.mjs run_cancel '{"run_id":"<id>"}'
```

## What this skill does NOT do

- Does not delete the mission, brief, or plan.
- Does not clear evidence or traces — those remain durable.
- Does not auto-create a replacement run.

## Reporting

```
mission_id: <id>
cancelled_run_id: <id>
tasks_cancelled: <count>
activations_cancelled: <count>
next_actions: <quoted from helper output>
→ <one sentence explaining what that step does>
```

After cancel, `next_actions` typically suggests `roi:inspect` or
`roi:draft` for a fresh run.
