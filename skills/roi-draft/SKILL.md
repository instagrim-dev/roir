---
name: roi-draft
description: Create a run on the latest plan. Thin alias for roi:run with built-in pause at verify_gate.
---

# roi:draft — start a run

`roi:draft` opens a run on a plan. The canonical run-lifecycle procedure
lives in **[`roi-run`](../roi-run/SKILL.md)** — open it and follow that
procedure.

This skill exists because operators often say "draft a run" before they
think in terms of `run_create`. There is no behavioral difference: both
call `run_create` via the lifecycle helper and pause at `verify_gate` when
the run reaches that stage.

A pause at `verify_gate` is **expected**, not a failure. The mandatory
verify-gate pause is owned by `roi:drive`; the operator advances by
running `roi:verify` explicitly.

## Reporting

Close with:

```
mission_id: <id>
run_id: <new_run_id>
mode: local | agent | a2a
status: <run status from helper>
next_actions: <quoted from helper output>
→ <one sentence explaining what that step does>
```

Most often, `next_actions` will lead with `roi:go` (implementation owed)
or `roi:verify` (paused at gate after stub implement).
