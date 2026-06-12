# ROI on OpenAI Codex — Migration from CE Skills

> **Part of the CE → ROI guide series.**
> Hub: [from-ce.md](./from-ce.md) · Claude Code: [from-ce-claude-code.md](./from-ce-claude-code.md) · Copilot: [from-ce-copilot.md](./from-ce-copilot.md)

---

## Setup (2 steps)

**1. Install dependencies** from the ROI package root (`roi/` checkout or unpacked `package/` directory):

```bash
pnpm install
```

**2. Install the ROI skill plugin** so `$roi-drive`, `$roi-go`, `$roi-work`,
etc. appear in the Codex skill picker (same mechanism as `$ce-brainstorm`):

```bash
scripts/install-agent-skills.sh codex
```

This creates `~/.local/share/roi/plugins/roi/` and registers it in
`~/.codex/config.toml`. **Restart Codex** after running to pick up the new
plugin.

ROI does not ship an MCP server, daemon, or long-running process. Each
`roi:*` skill shells to the lifecycle helper (`scripts/lifecycle.mjs`)
which opens, mutates, and closes the SQLite database in one transaction.

> For full setup detail and other hosts, see [`installation.md`](./installation.md).

---

## Hero entry point

Use `$roi-drive` from the Codex skill picker, or describe what you want in
natural language. Both dispatch the same lifecycle helper sequence.

**Skill picker (after plugin install):**

Type `$` in Codex to open the skill picker and select `roi-drive`. Pass your
goal as the argument:

> `$roi-drive` Refactor the user authentication module to support OAuth

**Natural language (no picker needed):**

> Drive an ROI mission for: Refactor the user authentication module to support OAuth

Either way, Codex opens the matching skill, which shells to the lifecycle
helper for `mission_create` + `brief_revise` to open the mission and seed
the brief, then continues advancing the pipeline from there.

---

## Full lifecycle walkthrough

> **This section shows what "drive a mission" does step by step.** You do not
> need to sequence these prompts manually — a single "drive" prompt handles
> the full pipeline. Use these individual prompts for fine-grained control.

**Goal used throughout:** "Refactor the user authentication module to support OAuth"

### Step 1 — Open the mission

**Prompt:**
> Start an ROI mission for: Refactor the user authentication module to support OAuth

→ Skill shells to: `mission_create`, `brief_revise`

**Expected artifacts:**
- New mission ID (e.g. `mission_abc123`)
- First brief revision created

### Step 2 — Refine the brief

**Prompt:**
> Refine the ROI brief for mission [mission ID]. Add: scope is limited to the
> login and session management code, success criteria is OAuth 2.0 PKCE flow
> working in staging, non-goals are social login providers.

→ Skill shells to: `brief_get_latest`, `brief_revise`

**Expected artifacts:**
- Updated brief revision with constraints and success criteria

### Step 3 — Generate the outline

**Prompt:**
> Generate a plan for the current ROI mission

→ Skill shells to: `plan_generate`

**Expected artifacts:**
- Plan stored under the mission with staged task list

### Step 4 — Start the draft

**Prompt:**
> Start a run for the current ROI mission

→ Skill shells to: `run_create`

**Expected artifacts:**
- Run record with staged tasks
- Run status: `paused` at `verify_gate`

### Step 5 — Close the review gate

**Prompt:**
> Evaluate the ROI verify gate — the implementation is complete and all tests pass

→ Skill shells to: `verify_evaluate`, `status_get`

**Expected artifacts:**
- Review record stored under the run
- Run advances to next stage or completes

### Step 6 — Publish the handoff

**Prompt:**
> Publish the ROI mission — record that the OAuth refactor is ready for staging review

→ Skill shells to: `status_get`, `evidence_record`

**Expected artifacts:**
- Evidence record stored under the mission
- Mission at handoff boundary

---

## Common gotchas

**Skill plugin must be registered.** `~/.codex/config.toml` must list the
ROI plugin path produced by `scripts/install-agent-skills.sh codex`. If
`$roi-drive` does not appear in the picker, re-run the installer and
restart Codex.

**SQLite single-writer.** Only one Codex session should write to
`roi.sqlite` at a time. If you run multiple sessions, set
`ROI_SQLITE_PATH` in the shell environment that launches Codex so each
session targets a distinct database file.

**`verify_gate` pause is intentional.** When a run pauses with
`next_actions: [roi:review]`, the run is waiting for your verdict. Prompt
Codex to "evaluate the ROI verify gate" (skill shells to
`verify_evaluate`). Do not create a new run; that does not advance the
paused one.

**Tool-approval prompts are expected on first use.** Codex may ask you to
approve each shell call from the ROI skills the first time it runs.
Approve once and continue.

---

## First-mission checklist

- [ ] `pnpm install` completed with no errors
- [ ] `scripts/install-agent-skills.sh codex` ran successfully; Codex restarted
- [ ] `$roi-drive` appears in the Codex skill picker (type `$` to open)
- [ ] `$roi-drive [goal]` (or equivalent natural-language prompt) returned a new mission ID
- [ ] Run status shows `paused` at `verify_gate`
- [ ] "Show ROI mission status" prompt shows: mission, brief, plan, run, and tasks
- [ ] "Evaluate the ROI verify gate" prompt advanced or completed the run
- [ ] Run result includes a review record

If any step fails, check [`troubleshooting.md`](./troubleshooting.md) or the
[FAQ](./faq.md).
