---
name: roi-source
description: Record structured source material and findings for an ROI mission.
---

**Direct multi-tool:** calls `research_record`, then `research_list` or
`research_summarize` as needed.

Use `research_record` (logical `research.record`) to store each finding with
question, findings, tradeoffs, sources, and recommendation. Records are
durable — they persist across sessions and inform outline + draft.

Use `research_list` to view all recorded sources for a mission, or
`research_summarize` to get a joined summary of recommendations and open
questions.

Next action: `roi:outline` once source material is sufficient for planning.
