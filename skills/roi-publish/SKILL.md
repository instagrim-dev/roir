---
name: roi-publish
description: Record a publication or handoff marker on a passing run. Finalizes the mission's external-facing artifact reference.
---

# roi:publish — publication marker

This skill records the publication marker for a run that has passed
`verify_gate`. It owns one stage: **confirm pass → record artifact evidence
→ next-step pointer**.

The publication marker is durable evidence with `type: publication` (or
`handoff` for cross-team handoff). It includes the artifact reference (URL,
file path, commit SHA, PR number, etc.) plus a summary of what shipped.

**Boundary:** this skill does not create the artifact. The artifact already
exists by the time this skill runs (PR merged, release tagged, file
committed). Publication is the act of *recording* that the mission delivered
something concrete.

**Convergence missions:** recording `publication` or `handoff` evidence
finalizes parent progress and re-elects the next seam in the declared
manifest. The parent controller does not advance until this evidence is
stored.

## Inputs

1. **Mission ID** required.
2. **Run ID** required — the run whose verdict was `pass`.
3. **Artifact reference** required — at least one of:
   - URL (PR link, release link, doc link).
   - File path (under `bmo/`, `roi/`, or another product tree).
   - Commit SHA.
   - External system ID (issue number, ticket ID).
4. **Summary** — one paragraph describing what shipped in operator-readable
   prose. This becomes the durable record outside any specific code review.

## Procedure

1. Confirm the run is publishable:

   ```bash
   node roi/scripts/lifecycle.mjs status_get '{"mission_id":"<id>"}'
   ```

   Look for `summary.latest_run` with `status: completed` or paused at a
   gate that has accepted `verify_evaluate(verdict=pass)`. If the verdict is
   `partial` with `partial_verification_checkpoint: true`, this skill should
   record a `handoff` (not `publication`) — the mission is not complete.

2. Persist the marker:

   ```bash
   node roi/scripts/lifecycle.mjs evidence_record '<json>'
   ```

   Where `<json>` includes:

   ```json
   {
     "mission_id": "<id>",
     "run_id": "<run_id>",
     "type": "publication",
     "source": "roi:publish",
     "result": "pass",
     "content": {
       "artifact_refs": ["https://github.com/instagrim-dev/bmo/pull/123", "bmo/internal/ops/"],
       "summary": "Hoisted ui/ops to top-level ops; agent and app no longer import internal/ui.",
       "commit_sha": "abc1234"
     }
   }
   ```

   Use `type: handoff` instead of `publication` when the mission's output is
   passed to another team or system rather than externally shipped.

## What this skill does NOT do

- Does not modify the run state (it remains in whatever terminal state
  `verify_evaluate` left it).
- Does not advance to `roi:learn` automatically — that's the operator's
  decision based on whether the work is pattern-worthy.
- Does not create the artifact. Publication is *recording*, not producing.

## Reporting

Close with:

```
mission_id: <id>
run_id: <run_id>
publication_type: publication|handoff
artifact_refs: <list>
next_actions: <quoted from helper output>
→ <one sentence explaining what that step does>
```

After publication, `next_actions` typically suggests `roi:learn` (capability
detection) or terminates. If `next_actions` is empty, the mission has
reached its terminal state — say so explicitly.
