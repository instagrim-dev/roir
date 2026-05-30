---
name: roi-brief
description: Refine the latest brief. Thin alias for roi:clarify.
---

# roi:brief — alias for `roi:clarify`

`roi:brief` is a thin alias for the brief-refinement stage. The canonical
procedure (read latest → revise → persist new revision) lives in
**[`roi-clarify`](../roi-clarify/SKILL.md)** — open it and follow that
procedure.

There is no behavioral difference between `roi:brief` and `roi:clarify`.
Both create a new brief revision via `brief_revise` on the lifecycle
helper. Prior revisions remain durable.

## Reporting

Use the Reporting block from
[`roi-clarify`](../roi-clarify/SKILL.md#reporting). Do not invent a
parallel template.
