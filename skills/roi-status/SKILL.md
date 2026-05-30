---
name: roi-status
description: Show current ROI mission summary, tasks, runs, and proposals. Thin alias for roi:inspect.
---

# roi:status — alias for `roi:inspect`

`roi:status` is a thin alias for the read-only mission view. The canonical
procedure lives in **[`roi-inspect`](../roi-inspect/SKILL.md)** — open it
and follow that procedure.

Both skills call `status_get` via the lifecycle helper and present:
mission, brief, plans, tasks, runs, policy decisions, capability
proposals, and `next_actions`. There is no behavioral difference.

## Reporting

Mirror the output structure from `roi:inspect` — there is no separate
template.
