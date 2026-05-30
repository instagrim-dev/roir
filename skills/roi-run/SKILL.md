---
name: roi-run
description: Create or resume an ROI run. Pauses at verify_gate by default.
---

# roi:run — run lifecycle

This skill creates or resumes a run on a plan. It owns one stage:
**create or resume run → report status → next-step pointer**.

A run is the executable instance of a plan. Runs pause at `verify_gate`
once their tasks complete; advancing past the pause requires `roi:verify`
(operator-owned).

## Inputs

1. **Mission ID** required.
2. **Plan ID** required for `run_create` (omit for `run_resume`).
3. **Run ID** required for `run_resume`.
4. **Mode** for `run_create`:

   | Mode | Behavior |
   |------|----------|
   | `local` | Stub implement (`LOCAL_EXECUTION_COMPLETED`); pair with **`roi:go`** for real repo work. |
   | `agent` | Host handoff (`AGENT_IMPLEMENT_HANDOFF`); run pauses until **`roi:go`** + `run_resume`. |
   | `a2a` | Remote delegation via agent card URL (set `agent_card_url`). |

## Procedure

To create:

```bash
node roi/scripts/lifecycle.mjs run_create '{"mission_id":"<id>","plan_id":"<plan>","mode":"local"}'
```

To resume:

```bash
node roi/scripts/lifecycle.mjs run_resume '{"run_id":"<run_id>"}'
```

To cancel an in-flight run, see [`roi-cancel`](../roi-cancel/SKILL.md).

Report task state, trace references, evidence, and `next_actions`. If the
run pauses at `verify_gate`, say so explicitly — that is expected, not a
failure — and point to `roi:verify`.

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
