---
name: roi-start
description: Start a new ROI mission and seed the first brief. Creates a durable mission row and an initial brief revision.
---

# roi:start — open a new ROI mission

This skill creates a new ROI mission. It owns one stage of the lifecycle:
**input → mission row + initial brief revision → next-step pointer**.

## Inputs (in priority order)

1. **Mission ID already known** — caller already has a `mission_id`. Skip this
   skill; go straight to `roi:clarify` (refines brief) or `roi:inspect` (reads
   state).
2. **File path** — `.md` or `.txt` containing problem framing. Extract:
   - **title** — first H1 heading, or first non-empty line trimmed to ≤ 80 chars.
   - **goal** — first paragraph after the title, or the file's frontmatter
     `goal:` field if present.
3. **Goal string** — free text. Use the goal as both title and goal; the
   operator can refine title later via `mission_update`.

If multiple inputs are provided, the priority order above wins.

## Procedure

1. Resolve title and goal from the input above. Both are required and must
   be non-empty after trimming. If either is missing, ask the operator before
   proceeding — do not invent.

2. Persist the mission. Run:

   ```bash
   node roi/scripts/lifecycle.mjs mission_create '<json>'
   ```

   where `<json>` is an object with at minimum `title`, `goal`, and `owner`.
   Optional fields: `priority` (default `"normal"`), `workspace_refs`
   (array of paths or URIs), `audience` (string).

   For long goals, write the JSON to a temp file and pipe via stdin:

   ```bash
   cat /tmp/roi-mission.json | node roi/scripts/lifecycle.mjs mission_create -
   ```

   The output is a JSON object containing the new `mission_id` and the
   seeded `brief_id` (revision 1). The mission row plus brief revision are
   written to `roi/.data/roi.sqlite` (or `$ROI_SQLITE_PATH`) before the
   command exits.

3. Confirm by reading back:

   ```bash
   node roi/scripts/lifecycle.mjs mission_get '{"mission_id":"<id>"}'
   ```

4. Report to the operator (use the **Reporting** template below).

## Reporting

Every ROI skill closes with the same shape so the lifecycle's idea of
"what's next" stays the single source of truth. Don't write a free-form
recommendation. Quote `next_actions` from the helper output verbatim and add
exactly one bridge sentence interpreting it.

Template:

```
mission_id: <id>
goal: <verbatim>
next_actions: <quoted from helper output, e.g. ["roi:brief"]>
→ <one sentence explaining what that step does and why it follows>
```

If `next_actions` is empty, say so and stop — do not invent a next step.
The lifecycle helper (which reads from SQLite) is the only authority on what
follows; if it disagrees with what feels right, surface the divergence to
the operator instead of silently overriding.

## What this skill does NOT do

- It does not refine the brief beyond the initial seed (problem = goal).
  That's `roi:clarify`'s job.
- It does not generate a plan. That's `roi:outline`.
- It does not run anything in the product repo. That's `roi:go`.
- It does not advance past mission creation. The lifecycle controller
  (`roi:drive`) handles cross-stage progression.

## Failure modes

- **Empty title or goal:** `mission_create` writes `"Untitled mission"` as a
  fallback. Avoid this — ask the operator instead.
- **Lifecycle helper missing or broken:** confirm `roi/scripts/lifecycle.mjs`
  exists and is executable. Run `node roi/scripts/lifecycle.mjs --list-verbs`
  to verify the registry is reachable. If the helper itself is broken, that's
  an infrastructure failure — surface it; do not retry blindly.

## Why the helper, not an MCP tool

Skills are the canonical interface for ROI across all four hosts (Claude Code,
Cursor, Codex, Copilot CLI). The MCP server has been retired. State lives in
SQLite at `roi/.data/roi.sqlite` (single source of truth) and is mutated by
the lifecycle helper. See `.cursor/rules/roi-commands.mdc` and `roi/AGENTS.md`
for the cross-host dispatch contract.
