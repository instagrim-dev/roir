---
name: roi-publish
description: Record a handoff-ready publication state for an ROI artifact.
---

**Compound handoff step:** calls `status_get` then `evidence_record`.

Use `status_get` to confirm the current mission or run is ready to hand off.
When publication or handoff evidence should be persisted, use `evidence_record`
(logical `evidence.record`) with an appropriate type: `publication` or
`handoff`.

**Convergence missions:** recording `publication` or `handoff` evidence
finalizes parent progress and re-elects the next seam in the declared
manifest. The parent controller does not advance until this evidence is stored.

Summarize what is ready, what artifact references matter, and whether the next
move is `roi:learn`, `roi:inspect`, or `roi:draft` for the next active seam.

Next action: `roi:learn` (to check for reusable patterns) or `roi:inspect`
(to review final state).
