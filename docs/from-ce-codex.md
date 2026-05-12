# ROI on OpenAI Codex — Migration from CE Skills

> **Part of the CE → ROI guide series.**
> Hub: [from-ce.md](./from-ce.md) · Claude Code: [from-ce-claude-code.md](./from-ce-claude-code.md) · Copilot: [from-ce-copilot.md](./from-ce-copilot.md)

---

## Setup (3 steps)

**1. Install dependencies** from the `roi/` directory:

```bash
pnpm install
```

**2. Register the ROI MCP server.** Merge the checked-in Codex config snippet
into your user or project config.

**Option A — CLI (quickest):**

```bash
codex mcp add roi -- node /absolute/path/to/src/server.mjs
```

Then open `~/.codex/config.toml` and add `cwd` under the generated entry:

```toml
[mcp_servers.roi]
command = "node"
args = ["/absolute/path/to/src/server.mjs"]
cwd = "/absolute/path/to/roi"
```

**Option B — Config snippet (full control):**

Copy `roi/codex/config.snippet.toml` and merge the `[mcp_servers.roi]` block
into `~/.codex/config.toml` (user-wide) or `.codex/config.toml` (trusted
project), substituting your actual checkout path.

**Verify MCP:** Run `codex mcp list` or use `/mcp` in the Codex TUI to confirm
the `roi` server appears.

**3. Install the ROI skill plugin** so `$roi-drive`, `$roi-go`, `$roi-work`,
etc. appear in the Codex skill picker (same mechanism as `$ce-brainstorm`):

```bash
roi/scripts/install-agent-skills.sh codex
```

This creates `~/.local/share/roi/plugins/roi/` and registers it in
`~/.codex/config.toml`. **Restart Codex** after running to pick up the new
plugin.

> For full setup detail, see [`installation.md`](./installation.md) Options 2 and 5.

---

## Hero entry point

Use `$roi-drive` from the Codex skill picker, or describe what you want in
natural language. Both dispatch the same ROI MCP tool sequence.

**Skill picker (after plugin install):**

Type `$` in Codex to open the skill picker and select `roi-drive`. Pass your
goal as the argument:

> `$roi-drive` Refactor the user authentication module to support OAuth

**Natural language (no picker needed):**

> Drive an ROI mission for: Refactor the user authentication module to support OAuth

Either way, Codex calls `roi.status_get` first, then `roi.mission_create` +
`roi.brief_revise` to open the mission and seed the brief, and continues
advancing the pipeline from there.

> **First-use note:** Codex may prompt you to approve each `roi.*` tool the
> first time it is called. Approve once per tool; subsequent calls in the same
> session proceed without prompts.

---

## Full lifecycle walkthrough

> **This section shows what "drive a mission" does step by step.** You do not
> need to sequence these prompts manually — a single "drive" prompt handles
> the full pipeline. Use these individual prompts for fine-grained control.

**Goal used throughout:** "Refactor the user authentication module to support OAuth"

### Step 1 — Open the mission

**Prompt:**
> Start an ROI mission for: Refactor the user authentication module to support OAuth

→ Codex calls: `roi.mission_create`, `roi.brief_revise`

**Expected artifacts:**
- New mission ID (e.g. `mission_abc123`)
- First brief revision created

### Step 2 — Refine the brief

**Prompt:**
> Refine the ROI brief for mission [mission ID]. Add: scope is limited to the
> login and session management code, success criteria is OAuth 2.0 PKCE flow
> working in staging, non-goals are social login providers.

→ Codex calls: `roi.brief_get_latest`, `roi.brief_revise`

**Expected artifacts:**
- Updated brief revision with constraints and success criteria

### Step 3 — Generate the outline

**Prompt:**
> Generate a plan for the current ROI mission

→ Codex calls: `roi.plan_generate`

**Expected artifacts:**
- Plan stored under the mission with staged task list

### Step 4 — Start the draft

**Prompt:**
> Start a run for the current ROI mission

→ Codex calls: `roi.run_create`

**Expected artifacts:**
- Run record with staged tasks
- Run status: `paused` at `verify_gate`

### Step 5 — Close the review gate

**Prompt:**
> Evaluate the ROI verify gate — the implementation is complete and all tests pass

→ Codex calls: `roi.verify_evaluate`, `roi.status_get`

**Expected artifacts:**
- Review record stored under the run
- Run advances to next stage or completes

### Step 6 — Publish the handoff

**Prompt:**
> Publish the ROI mission — record that the OAuth refactor is ready for staging review

→ Codex calls: `roi.status_get`, `roi.evidence_record`

**Expected artifacts:**
- Evidence record stored under the mission
- Mission at handoff boundary

---

## Common gotchas

**Absolute path required.** `~/.codex/config.toml` must contain an absolute
path to `src/server.mjs`. The `~` shorthand and relative paths are not expanded
in TOML configs — use the full `/Users/name/...` path.

**`cwd` is required.** Without `cwd = "/absolute/path/to/roi"`, the server may
fail to find its relative file references. Include it even if Option A (CLI
add) did not add it automatically.

**SQLite single-writer.** Only one Codex session should write to `roi.sqlite`
at a time. If you run multiple sessions, use `ROI_SQLITE_PATH` under
`[mcp_servers.roi.env]` in `config.toml` to point each session at a different
database file.

**`verify_gate` pause is intentional.** When a run pauses with `next_actions:
[roi:review]`, the run is waiting for your verdict. Prompt Codex to "evaluate
the ROI verify gate" (calls `roi.verify_evaluate`). Do not create a new run;
that does not advance the paused one.

**Tool-approval prompts are expected on first use.** Codex may ask you to
approve each `roi.*` tool the first time it is invoked in a session. This is
normal — approve once and continue.

---

## First-mission checklist

- [ ] `pnpm install` completed with no errors
- [ ] `~/.codex/config.toml` (or project `.codex/config.toml`) contains `[mcp_servers.roi]` with correct absolute path
- [ ] `codex mcp list` (or `/mcp` in TUI) shows the `roi` server
- [ ] `scripts/install-agent-skills.sh codex` ran successfully; Codex restarted
- [ ] `$roi-drive` appears in the Codex skill picker (type `$` to open)
- [ ] `$roi-drive [goal]` (or equivalent natural-language prompt) returned a new mission ID
- [ ] Run status shows `paused` at `verify_gate`
- [ ] "Show ROI mission status" prompt shows: mission, brief, plan, run, and tasks
- [ ] "Evaluate the ROI verify gate" prompt advanced or completed the run
- [ ] Run result includes a review record

If any step fails, check [`troubleshooting.md`](./troubleshooting.md) or the
[FAQ](./faq.md).
