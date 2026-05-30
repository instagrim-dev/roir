# ROI on GitHub Copilot CLI — Migration from CE Skills

> **Part of the CE → ROI guide series.**
> Hub: [from-ce.md](./from-ce.md) · Claude Code: [from-ce-claude-code.md](./from-ce-claude-code.md) · Codex: [from-ce-codex.md](./from-ce-codex.md)

---

## Setup (2 steps)

**1. Install dependencies** from the `roi/` directory:

```bash
pnpm install
```

**2. Install the ROI skill plugin** so `$roi-drive`, `$roi-go`, `$roi-work`,
etc. appear in the Copilot skill picker (same mechanism as
compound-engineering):

```bash
roi/scripts/install-agent-skills.sh copilot
```

This symlinks `skills/` into `~/.copilot/installed-plugins/roi-plugin/`
and registers the plugin in `~/.copilot/settings.json`. **Restart `gh
copilot`** after running.

ROI does not ship an MCP server, daemon, or long-running process. Each
`roi:*` skill shells to the lifecycle helper (`scripts/lifecycle.mjs`)
which opens, mutates, and closes the SQLite database in one transaction.

> For full setup detail and other hosts, see [`installation.md`](./installation.md).

---

## Hero entry point

Use `$roi-drive` from the Copilot skill picker, or describe what you want
in natural language. Both dispatch the same lifecycle helper sequence.

**Skill picker (after plugin install):**

Type `$` in Copilot CLI to open the skill picker and select `roi-drive`.
Pass your goal as the argument:

> `$roi-drive` Refactor the user authentication module to support OAuth

**Natural language:**

> Drive an ROI mission for: Refactor the user authentication module to support OAuth

Copilot opens the matching skill, which shells to the lifecycle helper to
check for an existing mission, then opens a new mission, seeds the brief,
generates a plan, starts a run, and advances the pipeline automatically.

---

## Full lifecycle walkthrough

> **This section shows what "drive a mission" does step by step.** A single
> drive prompt handles the full pipeline. Use these individual prompts for
> fine-grained control.

**Goal used throughout:** "Refactor the user authentication module to support OAuth"

### Step 1 — Open the mission

**Prompt:**
> Start an ROI mission: Refactor the user authentication module to support OAuth

→ Skill shells to: `mission_create`, `brief_revise`

**Expected artifacts:**
- New mission ID (e.g. `mission_abc123`)
- First brief revision created

### Step 2 — Refine the brief

**Prompt:**
> Update the ROI brief for mission [mission ID]: scope is login and session
> management code, success criteria is OAuth 2.0 PKCE in staging, non-goals
> are social login providers.

→ Skill shells to: `brief_get_latest`, `brief_revise`

**Expected artifacts:**
- Updated brief revision with constraints and success criteria

### Step 3 — Generate the outline

**Prompt:**
> Generate an ROI plan for mission [mission ID]

→ Skill shells to: `plan_generate`

**Expected artifacts:**
- Plan stored under the mission with staged task list

### Step 4 — Start the draft

**Prompt:**
> Start an ROI run for mission [mission ID]

→ Skill shells to: `run_create`

**Expected artifacts:**
- Run record with staged tasks
- Run status: `paused` at `verify_gate`

### Step 5 — Close the review gate

**Prompt:**
> Evaluate the ROI verify gate for mission [mission ID] — implementation is
> complete and tests pass.

→ Skill shells to: `verify_evaluate`, `status_get`

**Expected artifacts:**
- Review record stored under the run
- Run advances to next stage or completes

### Step 6 — Publish the handoff

**Prompt:**
> Record ROI evidence that the OAuth refactor is ready for staging review.

→ Skill shells to: `status_get`, `evidence_record`

**Expected artifacts:**
- Evidence record stored under the mission
- Mission at handoff boundary

---

## Common gotchas

**Skill plugin must be registered.** `~/.copilot/settings.json` must list
the ROI plugin path produced by `scripts/install-agent-skills.sh
copilot`. If `$roi-drive` does not appear in the picker, re-run the
installer and restart `gh copilot`.

**SQLite single-writer.** Only one Copilot CLI session should write to
`roi.sqlite` at a time. If you need session isolation, set
`ROI_SQLITE_PATH` in the shell environment that launches Copilot so each
session targets a distinct database file.

**`verify_gate` pause is intentional.** When a run pauses with
`next_actions: [roi:review]`, the run is waiting for your verdict.
Prompt Copilot to "evaluate the ROI verify gate" (skill shells to
`verify_evaluate`). Creating a new run does not advance the paused one.

**Verb names use underscores.** When discussing lifecycle verbs in
prompts, use `mission_create` not `mission.create` or `roi:work`. The
underscore form is the canonical wire name.

---

## First-mission checklist

- [ ] `pnpm install` completed with no errors
- [ ] `scripts/install-agent-skills.sh copilot` ran successfully; Copilot restarted
- [ ] `$roi-drive` appears in the Copilot skill picker (type `$` to open)
- [ ] `$roi-drive [goal]` returned a new mission ID
- [ ] Run status shows `paused` at `verify_gate`
- [ ] "Show ROI status for mission [mission ID]" shows: mission, brief, plan, run, and tasks
- [ ] "Evaluate the ROI verify gate" prompt advanced or completed the run
- [ ] Run result includes a review record

If any step fails, check [`troubleshooting.md`](./troubleshooting.md) or the
[FAQ](./faq.md).
