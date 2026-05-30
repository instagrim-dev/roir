---
name: roi-source
description: Record structured source material and findings for an ROI mission.
---

# roi:source — research recording

This skill records research findings on a mission. It owns one stage:
**capture finding → persist → next-step pointer**.

Records are durable — they persist across sessions and inform outline
and draft.

## Inputs

1. **Mission ID** required.
2. **Finding** — at minimum a `question` and `findings` payload. Optional:
   `tradeoffs`, `sources` (array of URLs / file paths), `recommendation`.

## Procedure

```bash
node roi/scripts/lifecycle.mjs research_record '<json>'
```

Where `<json>` includes:

```json
{
  "mission_id": "<id>",
  "question": "What does internal/ui/ops actually do?",
  "findings": "Defines four operations the agent invokes via UI helpers...",
  "tradeoffs": "Hoisting to internal/ops decouples agent from UI but...",
  "sources": ["bmo/internal/ui/ops/ops.go"],
  "recommendation": "Hoist; rewrite imports; add guard test."
}
```

To inspect existing research:

```bash
node roi/scripts/lifecycle.mjs research_list '{"mission_id":"<id>"}'
node roi/scripts/lifecycle.mjs research_summarize '{"mission_id":"<id>"}'
```

## What this skill does NOT do

- Does not refine the brief — that's `roi:clarify`. Research **informs**
  the brief; it does not replace it.
- Does not generate plans — that's `roi:outline`.

## Reporting

```
mission_id: <id>
research_records_added: <count>
next_actions: <quoted from helper output>
→ <one sentence>
```

After enough research is captured, `next_actions` typically suggests
`roi:clarify` (refine brief) or `roi:outline` (generate plans).
