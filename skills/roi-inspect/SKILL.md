---
name: roi-inspect
description: Show the current ROI mission summary, draft state, traces, reviews, and learning opportunities.
---

**Direct read-only:** calls `status_get` (logical `status.get`) once.

Use at any point in the lifecycle — not only after publication. `roi:inspect`
is the primary operator view for understanding current mission state.

Presents: mission, brief, plans, tasks, runs, policy decisions, routing
decisions, capability activations, review records, trace and evidence counts,
patterns, capability proposals, learning readiness, convergence controller
state (when present), and recommended next actions.

For full trace or evidence content, use `trace_list` or `evidence_list`
directly with the mission or run ID.
