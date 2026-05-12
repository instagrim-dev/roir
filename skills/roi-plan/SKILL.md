---
name: roi-plan
description: Generate atomic ROI plans with dependencies and verification targets.
---

Alias for the outline/planning pass. Follow **`roi-outline`** and read
[`references/agentic-plan-strength.md`](../references/agentic-plan-strength.md)
before calling `plan_generate`.

Use `plan_generate` (logical `plan.generate`) to create one or more atomic plans.
Keep actions concrete **at the outcome layer**, dependencies explicit, and
verification targets **property-style oracles** — testable without prescribing
implementation scripts.
