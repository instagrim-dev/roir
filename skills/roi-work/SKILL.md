---
name: roi-work
description: Open a new ROI mission and seed the first brief. Thin alias for roi:start.
---

# roi:work — alias for `roi:start`

`roi:work` is a thin alias kept for compatibility with operator vocabulary
that says "start working on…" or "open a mission for…". The actual stage
procedure lives in **[`roi-start`](../roi-start/SKILL.md)** — open it and
follow that procedure.

Both skills:

1. Resolve input (mission ID / file / goal string).
2. Call `mission_create` via the lifecycle helper when no matching mission
   exists.
3. Report `mission_id`, `goal`, and `next_actions` in the standard
   Reporting block.

There is no behavioral difference between `roi:work` and `roi:start`.
Operators can use whichever phrasing comes naturally; the lifecycle ends
up in the same state.

## Reporting

Use the same Reporting block as `roi:start`. Do not duplicate the
template here — the canonical version lives in
[`roi-start`](../roi-start/SKILL.md#reporting).
