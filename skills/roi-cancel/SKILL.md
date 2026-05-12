---
name: roi-cancel
description: Cancel an in-flight or paused run, marking all pending tasks and activations as cancelled.
---

**Direct:** calls `run_cancel` (logical `run.cancel`) with the run ID.

Use when a draft run should be abandoned before completion. This transitions the
run, all its pending tasks, and all its active capability activations to
`cancelled`. The mission and plan remain intact — start a new run with
`roi:draft` when you are ready to resume work.

The run ID is visible in `roi:inspect` output under the `runs` field, or in
the last `roi:draft` response.

Report the cancelled run ID and the count of tasks and activations that were
cancelled.

Next action: `roi:inspect` to confirm state, or `roi:draft` to begin a new
run on the same plan.
