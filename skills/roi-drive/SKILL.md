---
name: roi-drive
description: Thin ROI lifecycle orchestrator. Reads next_actions from the lifecycle helper and delegates to the named stage skill. Pauses at verify_gate and publish_gate by default.
---

# roi:drive — thin lifecycle orchestrator

This skill is a loop, not a stage. On each iteration:

1. Read `status_get` to see where the mission is.
2. Read `next_actions` from the helper output.
3. Open the named stage skill and execute its procedure.
4. Re-read `status_get` and repeat until a **mandatory pause** or terminal
   state.

`roi:drive` does not edit the brief, does not implement code, does not
record evidence, does not record verdicts. It only **dispatches** to the
stage skill that owns each verb.

## Mandatory pauses

`roi:drive` stops without auto-advancing past either gate:

| Gate | Why pause |
|------|-----------|
| `verify_gate` | Recording a verdict is a judgment call; the operator must approve the verdict notes before the run advances. |
| `publish_gate` | Publication writes the externally-visible artifact reference; the operator must confirm before that record is durable. |

When `next_actions` leads with `roi:verify` or `roi:publish`, drive **stops
and reports** instead of executing. The operator runs the named skill
explicitly.

## Procedure

```text
loop:
  status = status_get(mission_id)
  next   = status.summary.next_actions

  if next is empty:
    report terminal state and stop
  if next[0] in {roi:verify, roi:publish}:
    report pause reason and stop
  else:
    open the SKILL.md for next[0] (e.g. roi:go → roi-go/SKILL.md)
    execute its procedure to completion
    continue loop
```

After each stage skill runs, re-read `status_get` — do not assume
`next_actions` from a stale read.

## Inputs

1. **Mission ID** required. (Use the mission ID from the previous turn when
   omitted.)
2. **Optional operator constraint** — `drive only` (do not invoke `roi:go`),
   `strict` / `verified` (require helper-verified proof at the gate).

## Operator constraints

| Phrase | Effect |
|--------|--------|
| `drive only` | When `next_actions` leads with `roi:go`, stop and report — do not execute the implementation skill. |
| `strict` / `verified` | When `roi:go` is invoked, it must use `run_oracles: true` on every `evidence_record` pass; when `roi:verify` is reached, the verdict must use `require_verified_proof: true`. Also auto-applies when `status_get.summary.verification_policy` is `strict`. The operator runs `roi:verify` themselves under the mandatory pause; this skill only records that strict mode is active in the report. |

## What this skill does NOT do

- Does not call `mission_create`, `brief_revise`, `plan_generate`,
  `evidence_record`, `verify_evaluate`, `enlighten_run` directly. Those
  belong to the stage skills.
- Does not skip the verify or publish gates. Operator approval is required.
- Does not interpret evidence quality. That is `roi:verify`'s job.
- Does not auto-promote capabilities (`roi:learn` proposes; operator
  promotes).

## Reporting

After each iteration of the loop, emit one line per stage executed:

```
→ ran roi:go (3 plans, all pass)
→ ran roi:clarify (revision 2)
```

On stop (terminal or pause), close with:

```
mission_id: <id>
stages_run_this_invocation: [<list>]
stop_reason: terminal | mandatory_pause:<gate> | operator_constraint
next_actions: <quoted from latest status_get>
→ <one sentence explaining what the operator should run next>
```

If the lifecycle helper's `next_actions` disagrees with what the situation
seems to call for, surface that to the operator. The helper is the single
authority on what follows; this skill does not override it.
