---
name: roi-review
description: Evaluate a run's evidence and record a verdict. Thin alias for roi:verify.
---

# roi:review — alias for `roi:verify`

`roi:review` is a thin alias for the verify-gate stage. The canonical
procedure (read evidence → judge → record verdict) lives in
**[`roi-verify`](../roi-verify/SKILL.md)** — open it and follow that
procedure.

Both skills call `verify_evaluate` via the lifecycle helper and surface
the verdict (`pass` / `partial` / `fail` / `inconclusive`) to the
operator. There is no behavioral difference.

The `roi:edit → roi:review` loop may repeat multiple times before
publication. After a passing verdict, `next_actions` points to
`roi:publish`.

**Agentic evidence:** Verdicts must cite **falsified or satisfied
properties** (acceptance criteria / `verification_targets`), not "touched
every file in the plan." See
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md).

## Reporting

Use the Reporting block from
[`roi-verify`](../roi-verify/SKILL.md#reporting).
