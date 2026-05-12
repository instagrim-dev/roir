---
name: roi-review
description: Review draft outputs, record a verdict, and point to the next edit or publish step.
---

**Compound quality gate:** calls `status_get`, `review_list`, then
`verify_evaluate` to record the verdict.

Use `status_get` (logical `status.get`) and `review_list` to understand the
current mission and run state. Then use `verify_evaluate` (logical
`verify.evaluate`) to record the review verdict (`pass`, `partial`, `fail`,
or `inconclusive`) for the target run. For **strict** missions, pass
`require_verified_proof: true` on `pass` so only `mcp_verified` substantive
`roi:go` evidence satisfies the gate (see `roi-drive` strict mode).

Surface the verdict clearly. If the verdict is `pass`, point to `roi:publish`.
If `fail` or `partial`, point to `roi:edit` and summarize the blocking issues.

**Agentic evidence:** Verdicts should cite **falsified or satisfied properties**
(acceptance criteria / `verification_targets`), not “touched every file in the
plan.” See [`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md).

**Re-entry:** when `roi:edit` produces a new draft, return here with
`roi:review` again. The loop repeats until the run is publishable.

Next action: `roi:edit` (on fail/partial) or `roi:publish` (on pass).
