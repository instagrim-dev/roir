---
name: roi-learn
description: Detect reusable patterns from completed runs and propose a human-gated capability. The detection is the work; promotion is a separate human decision.
---

# roi:learn — pattern detection and capability proposal

This skill runs the learning pass on a completed mission to detect reusable
patterns and propose a capability. It owns one stage: **read completed
work → detect patterns → propose capability → next-step pointer**.

The output is **not** a promoted capability. Promotion is a separate
operator action via `capability_promote` (a human gate by design — patterns
proposed without proof of repeated success would pollute the registry).

**A `noop` result is expected and not an error** until at least 3 successful
capability activations exist for the mission. Early missions almost always
return `noop`.

## Inputs

1. **Mission ID** required — must reference a mission with at least one
   completed, published run.

## Procedure

1. Confirm the mission is in a learning-eligible state:

   ```bash
   node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
   ```

   Look at `summary.learning_readiness`. If empty or shows insufficient
   activation history, expect a `noop` from `enlighten_run`.

2. Run the learning pass:

   ```bash
   node roi/scripts/lifecycle.mjs enlighten_run '{"mission_id":"<id>"}'
   ```

   The output is one of:

   - `{"status": "noop", "reason": "..."}` — no pattern with sufficient
     repetition. Expected outcome for early missions.
   - `{"status": "pattern_detected", "pattern": {...}, "proposal": {...}}` —
     a candidate capability has been proposed.

3. If a proposal exists:

   - Read the proposal (`pattern.detect` lineage, `proposal.capability`).
   - Decide whether to promote. Promotion is irreversible without an
     explicit demote, so judge whether the pattern is broadly applicable
     and not just a coincidence of this mission's structure.
   - To promote:

     ```bash
     node roi/scripts/lifecycle.mjs capability_promote '<json>'
     ```

     Promotion is **operator-gated**: do not auto-call it. Surface the
     proposal to the operator and let them decide.

## What this skill does NOT do

- Does not auto-promote (`capability_promote` is a deliberate human gate).
- Does not detect patterns from in-flight runs — wait until a publication
  marker exists.
- Does not delete patterns (use `pattern_list` to inspect; demotion is a
  separate flow if needed).
- Does not retain learning automatically. Pattern detection is the work;
  storage of the proposal is durable; promotion is operator-only.

## Reporting

Close with:

```
mission_id: <id>
status: noop | pattern_detected
pattern_id: <id if any>
proposal_id: <id if any>
proposed_capability: <name if any>
next_actions: <quoted from helper output>
→ <one sentence explaining what that step does>
```

On `noop`, the bridge sentence should explain why — usually "fewer than 3
successful activations on this mission." On `pattern_detected`, the bridge
should name the pattern's apparent applicability and recommend
`capability_promote` only if the operator agrees it generalizes.
