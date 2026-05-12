---
name: roi-draft
description: Create and execute an ROI draft run locally or through A2A delegation.
---

**Direct (with built-in gate):** calls `run_create` or `run_resume`, then
typically pauses at the `verify_gate` stage. After pausing, use `roi:review`
to advance. Do not treat a pause as a failure.

Use `run_create` (logical `run.create`) with `mode=local` for local execution
and `mode=a2a` when remote delegation is needed. Use `run_resume` to continue
a paused run.

To cancel an in-flight run, use `run_cancel` with the run ID.

Report task state, trace references, evidence, and next actions. If the run
pauses at `verify_gate`, say so explicitly and suggest `roi:review`.

Next action: `roi:review` (after a pause or on completion of staged tasks).
