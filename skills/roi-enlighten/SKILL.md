---
name: roi-enlighten
description: Detect reusable patterns and propose a human-gated capability. Thin alias for roi:learn.
---

# roi:enlighten — alias for `roi:learn`

`roi:enlighten` is a thin alias for the learning-pass stage. The canonical
procedure lives in **[`roi-learn`](../roi-learn/SKILL.md)** — open it and
follow that procedure.

Both skills call `enlighten_run` via the lifecycle helper. A `noop` result
is expected for early missions; promotion is operator-only via
`capability_promote`.

## Reporting

Use the Reporting block from
[`roi-learn`](../roi-learn/SKILL.md#reporting).
