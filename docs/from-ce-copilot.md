# ROI on GitHub Copilot CLI — Migration from CE Skills

> **Part of the CE → ROI guide series.**
> Hub: [from-ce.md](./from-ce.md) · Claude Code: [from-ce-claude-code.md](./from-ce-claude-code.md) · Codex: [from-ce-codex.md](./from-ce-codex.md)

---

## Setup (3 steps)

**1. Install dependencies** from the `roi/` directory:

```bash
pnpm install
```

**2. Register the ROI MCP server.**

**Option A — Interactive (easiest):**

Start Copilot CLI and use `/mcp add`:

```
/mcp add roi node /absolute/path/to/src/server.mjs
```

**Option B — Config file (full control):**

Copy `roi/copilot/mcp-config.json` and merge the `roi` entry into
`~/.copilot/mcp-config.json`, substituting your actual checkout path:

```json
{
  "mcpServers": {
    "roi": {
      "type": "local",
      "command": "node",
      "args": ["/absolute/path/to/src/server.mjs"],
      "env": {},
      "tools": ["*"]
    }
  }
}
```

**Verify MCP:** Run `/mcp show` in Copilot CLI to confirm the `roi` server appears.

**3. Install the ROI skill plugin** so `$roi-drive`, `$roi-go`, `$roi-work`,
etc. appear in the Copilot skill picker (same mechanism as compound-engineering):

```bash
roi/scripts/install-agent-skills.sh copilot
```

This symlinks `skills/` into `~/.copilot/installed-plugins/roi-plugin/` and
registers the plugin in `~/.copilot/settings.json`. **Restart `gh copilot`**
after running.

> For full setup detail, see [`installation.md`](./installation.md) Options 3.

---

## Hero entry point

Use `$roi-drive` from the Copilot skill picker, or describe what you want with
a `#mcp.roi` hint. Both dispatch the same ROI MCP tool sequence.

**Skill picker (after plugin install):**

Type `$` in Copilot CLI to open the skill picker and select `roi-drive`. Pass
your goal as the argument:

> `$roi-drive` Refactor the user authentication module to support OAuth

**Natural language with MCP hint:**

> Using #mcp.roi, drive a mission for: Refactor the user authentication module to support OAuth

Copilot will call `roi.status_get` to check for an existing mission, then open
a new mission, seed the brief, generate a plan, start a run, and advance
the pipeline automatically.

For subsequent interactions, the `#mcp.roi` hint is optional if only one MCP
server is active — include it when Copilot has multiple servers and you want to
be explicit.

---

## Full lifecycle walkthrough

> **This section shows what "drive a mission" does step by step.** A single
> drive prompt handles the full pipeline. Use these individual prompts for
> fine-grained control.

**Goal used throughout:** "Refactor the user authentication module to support OAuth"

### Step 1 — Open the mission

**Prompt:**
> Using #mcp.roi.mission_create, start a mission: Refactor the user authentication module to support OAuth

→ Copilot calls: `roi.mission_create`, `roi.brief_revise`

**Expected artifacts:**
- New mission ID (e.g. `mission_abc123`)
- First brief revision created

### Step 2 — Refine the brief

**Prompt:**
> Update the ROI brief for mission [mission ID]: scope is login and session
> management code, success criteria is OAuth 2.0 PKCE in staging, non-goals
> are social login providers. Use #mcp.roi.brief_revise.

→ Copilot calls: `roi.brief_get_latest`, `roi.brief_revise`

**Expected artifacts:**
- Updated brief revision with constraints and success criteria

### Step 3 — Generate the outline

**Prompt:**
> Generate an ROI plan for mission [mission ID] using #mcp.roi.plan_generate

→ Copilot calls: `roi.plan_generate`

**Expected artifacts:**
- Plan stored under the mission with staged task list

### Step 4 — Start the draft

**Prompt:**
> Start an ROI run for mission [mission ID] using #mcp.roi.run_create

→ Copilot calls: `roi.run_create`

**Expected artifacts:**
- Run record with staged tasks
- Run status: `paused` at `verify_gate`

### Step 5 — Close the review gate

**Prompt:**
> Evaluate the ROI verify gate for mission [mission ID] — implementation is
> complete and tests pass. Use #mcp.roi.verify_evaluate.

→ Copilot calls: `roi.verify_evaluate`, `roi.status_get`

**Expected artifacts:**
- Review record stored under the run
- Run advances to next stage or completes

### Step 6 — Publish the handoff

**Prompt:**
> Record ROI evidence that the OAuth refactor is ready for staging review.
> Use #mcp.roi.evidence_record.

→ Copilot calls: `roi.status_get`, `roi.evidence_record`

**Expected artifacts:**
- Evidence record stored under the mission
- Mission at handoff boundary

---

## Common gotchas

**Absolute path required.** `~/.copilot/mcp-config.json` must contain an
absolute path to `src/server.mjs`. The `~` shorthand is not expanded in JSON
configs — use the full `/Users/name/...` path.

**SQLite single-writer.** Only one Copilot CLI session should write to
`roi.sqlite` at a time. Use the `env` block in `mcp-config.json` to set
`ROI_SQLITE_PATH` if you need session isolation:

```json
"env": { "ROI_SQLITE_PATH": "/path/to/your/roi.sqlite" }
```

**`verify_gate` pause is intentional.** When a run pauses with `next_actions:
[roi:review]`, the run is waiting for your verdict. Prompt Copilot to
"evaluate the ROI verify gate" using `#mcp.roi.verify_evaluate`. Creating a
new run does not advance the paused one.

**`tools: ["*"]` allows all ROI tools.** The template uses a wildcard grant. If
your environment restricts wildcard grants, replace `"*"` with the explicit list
of ROI tool names from [`command-reference.md`](./command-reference.md). Using
`"*"` is recommended for development use.

**Tool names use underscores.** In `#mcp.roi.*` references, use
`roi.mission_create` not `roi.mission.create` or `roi:work`. The MCP tool name
is always underscore-separated.

---

## First-mission checklist

- [ ] `pnpm install` completed with no errors
- [ ] `~/.copilot/mcp-config.json` contains the `roi` server entry with correct absolute path
- [ ] `/mcp show` confirms the `roi` server is listed
- [ ] `scripts/install-agent-skills.sh copilot` ran successfully; Copilot restarted
- [ ] `$roi-drive` appears in the Copilot skill picker (type `$` to open)
- [ ] `$roi-drive [goal]` (or equivalent `#mcp.roi` prompt) returned a new mission ID
- [ ] Run status shows `paused` at `verify_gate`
- [ ] "Show ROI status for mission [mission ID]" shows: mission, brief, plan, run, and tasks
- [ ] "Evaluate the ROI verify gate" prompt advanced or completed the run
- [ ] Run result includes a review record

If any step fails, check [`troubleshooting.md`](./troubleshooting.md) or the
[FAQ](./faq.md).
