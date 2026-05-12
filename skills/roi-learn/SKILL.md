---
name: roi-learn
description: Detect repeated successful patterns and propose a human-gated capability through the learning pass.
---

Use `enlighten_run` (wire name; logical `enlighten.run`) after published or
repeatedly successful reviewed work. This command detects patterns and
proposes a capability — it does not retain learning automatically. Capability
proposals always require human promotion via `capability_promote`.

**A `noop` result is expected and not an error** until at least 3 successful
capability activations exist for the mission.

Report the detected pattern (if any) and the proposed capability (if any).
Note whether the result was `noop` or a new proposal, and point to
`capability_promote` when a proposal exists.

Next action: `capability_promote` when a proposal exists, otherwise
`roi:inspect` to review mission state.
