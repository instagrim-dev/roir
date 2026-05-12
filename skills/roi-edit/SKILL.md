---
name: roi-edit
description: Respond to review findings by revising outlines or launching a follow-on draft.
---

**Compound revision loop:** calls `status_get`, then `plan_revise` and/or
`run_create` / `run_resume` depending on the nature of the fix.

Use `status_get` to inspect the current mission state and blocking review
signals. Classify the fix:
- **Structural fix** (wrong plan, wrong decomposition): use `plan_revise`
  to update the outline, then `run_create` for a new draft.
- **Execution fix** (implementation error, missing evidence): use
  `run_create` or `run_resume` to produce the next draft directly.

Summarize what changed and point back to `roi:review`. The
`roi:edit → roi:review` loop may repeat multiple times before publication.

Next action: `roi:review` to evaluate the revised draft.
