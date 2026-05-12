---
name: roi-brief
description: Refine the latest brief with scope, audience, constraints, and success criteria.
---

**Direct two-step:** calls `brief_get_latest` then `brief_revise`.

**Read when scoping agentic work:** [`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md) — briefs own **high-altitude** constraints, not file paths.

Use `brief_get_latest` (logical `brief.get_latest`) to inspect the current
brief, then call `brief_revise` (logical `brief.revise`) with the refined
problem framing, constraints, success criteria, assumptions, open questions,
and non-goals.

**Load-bearing brief fields:** `problem`, `constraints`, `success_criteria`, `non_goals`.

**Defer to plans:** file paths, line numbers, per-test implementation detail.

Briefs are revision-safe: each call to `brief_revise` creates a new revision
without overwriting prior ones.

Next action: `roi:source` to gather research, or `roi:outline` if source
material is already clear.
