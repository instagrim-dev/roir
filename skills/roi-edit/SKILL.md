---
name: roi-edit
description: Respond to review findings with plan revisions or a follow-on run. Thin orchestrator over plan_revise + run_create / run_resume.
---

# roi:edit — revision response

This skill responds to a non-pass verdict (or other blocking review
signal). It owns one stage: **classify the fix → revise plan or open a
new run → next-step pointer**.

The `roi:edit → roi:verify` loop may repeat multiple times before
publication. That is expected.

## Inputs

1. **Mission ID** required.
2. **Run ID** of the run that received the non-pass verdict.
3. **Findings** — the blocking issues to address (operator prose, or the
   `notes` field from the failed `verify_evaluate`).

## Procedure

1. Read state:

   ```bash
   node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
   ```

2. Classify the fix:

   - **Structural fix** — plan was wrong (wrong decomposition, missing
     verification target, wrong wave). Revise the plan:

     ```bash
     node roi/scripts/lifecycle.mjs plan_revise '<json>'
     ```

     Then open a new run:

     ```bash
     node roi/scripts/lifecycle.mjs run_create '<json>'
     ```

   - **Execution fix** — plan was right; implementation was missing or
     wrong. Either re-run `roi:go` against the existing plan or, if the
     prior run is still resumable:

     ```bash
     node roi/scripts/lifecycle.mjs run_resume '{"run_id":"<id>"}'
     ```

3. Summarize what changed and point back to `roi:verify`.

## What this skill does NOT do

- Does not record a new verdict (use `roi:verify` after the new draft).
- Does not implement (`roi:go` for that).
- Does not auto-loop — each `roi:edit` invocation produces one revision
  cycle.

## Reporting

```
mission_id: <id>
prior_run_id: <id>
new_run_id: <id if created>
plan_revisions: [<plan_id: <new revision int>>, ...] or (none)
fix_type: structural | execution
next_actions: <quoted from helper output>
→ <one sentence>
```
