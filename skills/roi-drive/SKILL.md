---
name: roi-drive
description: Thin ROI lifecycle orchestrator. Reads next_actions from the lifecycle helper, delegates task-bound orientation admission to the owning stage skill, and pauses at verify_gate and publish_gate by default.
---

# roi:drive — thin lifecycle orchestrator

This skill is a loop, not a stage. On each iteration:

1. Read `status_get` to see where the mission is.
2. Read `next_actions` and current orientation from the helper output.
3. Before dispatching execution, require current planning orientation for the
   selected plan and revision; dispatch `roi:outline` when it is missing,
   stale, blocked, or semantically incomplete.
4. Open the named stage skill and execute its procedure. The stage skill must
   refresh execution orientation before every host mutation and verification
   orientation before each verifier.
5. Re-read `status_get` and orientation state, then repeat until a **mandatory pause** or terminal
   state.

`roi:drive` does not edit the brief, does not implement code, does not
record evidence, does not record verdicts. It only **dispatches** to the
stage skill that owns each verb.

When the operator provides inline third-party Plan text instead of a stored
mission/plan, `roi:drive` still stays thin: run `plan_normalize` only to
identify the stage-owned payload, then dispatch to `roi:outline` or
`roi:go` to persist and execute it. Drive does not execute normalized
plans directly.

## Mandatory pauses

`roi:drive` delegates orientation-admission pauses to their stage owner. It
stops without auto-advancing past either judgment gate:

| Gate | Why pause |
|------|-----------|
| `verify_gate` | Recording a verdict is a judgment call; the operator must approve the verdict notes before the run advances. |
| `publish_gate` | Publication writes the externally-visible artifact reference; the operator must confirm before that record is durable. |

An implementation orientation pause dispatches `roi:go`; a spec, quality, or
verification orientation pause dispatches `roi:verify`. These are admission
requirements, not judgment gates, so drive re-reads lifecycle state after the
stage skill completes.

When `next_actions` leads with `roi:verify` or `roi:publish`, drive **stops
and reports** instead of executing. The operator runs the named skill
explicitly.

## Procedure

```text
loop:
  status = status_get(mission_id)
  next   = status.summary.next_actions
  orientation = orientation_list(mission_id)

  if next is empty:
    report terminal state and stop
  if next[0] in {roi:verify, roi:publish}:
    report pause reason and stop
  if next[0] == roi:go and planning orientation is not current for the selected plan revision:
    dispatch roi:outline to refresh planning orientation; do not execute
  else:
    open the SKILL.md for next[0] (e.g. roi:go → roi-go/SKILL.md)
    execute its procedure to completion
    continue loop
```

After each stage skill runs, re-read `status_get` and `orientation_list` — do
not assume `next_actions` or checkpoint currency from a stale read. Counts,
scores, percentages, and ContextPack TTL are telemetry only and cannot override
orientation state.

## Inputs

1. **Mission ID** required unless inline Plan text or a goal string is
   opening/resolving the mission through the next stage.
2. **Optional inline Plan text** — normalized through `plan_normalize`, then
   handed to the stage skill that owns durable writes.
3. **Optional operator constraint** — `drive only` (do not invoke `roi:go`),
   `strict` / `verified` (require helper-verified proof at the gate).

## Operator constraints

| Phrase | Effect |
|--------|--------|
| `drive only` | When `next_actions` leads with `roi:go`, stop and report — do not execute the implementation skill. |
| `strict` / `verified` | When `roi:go` is invoked, it must use `run_oracles: true` on every `evidence_record` pass; when `roi:verify` is reached, the verdict must use `require_verified_proof: true`. Also auto-applies when `status_get.summary.verification_policy` is `strict`. The operator runs `roi:verify` themselves under the mandatory pause; this skill only records that strict mode is active in the report. |

`roi:drive` never treats plan totals or “all pass” counts as sufficient to
dispatch or verify. Selection is constrained by current planning orientation;
partial verification is constrained by a current checkpoint's semantic scope.

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
→ ran roi:go (scope OS1/OS2; checkpoint current; progress counts reported separately)
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
