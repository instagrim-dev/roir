# ROI on Claude Code — Migration from CE Skills

> **Part of the CE → ROI guide series.**
> Hub: [from-ce.md](./from-ce.md) · Codex: [from-ce-codex.md](./from-ce-codex.md) · Copilot: [from-ce-copilot.md](./from-ce-copilot.md)

---

## Setup (2 steps)

**1. Install dependencies** from the ROI package root (`roi/` checkout or unpacked `package/` directory):

```bash
pnpm install
```

**2. Install the ROI skills** so `$roi-drive`, `$roi-go`, `$roi-work`,
etc. appear in the Claude skill picker:

```bash
scripts/install-agent-skills.sh claude-user
```

For a project-local install, use `scripts/install-agent-skills.sh claude-project`.

ROI does not ship an MCP server, daemon, or long-running process. Each
`roi:*` skill shells to the lifecycle helper (`scripts/lifecycle.mjs`),
which opens, mutates, and closes the SQLite database in one transaction.

> For full setup detail and other hosts, see [installation.md](./installation.md).

---

## Hero entry point

Use `$roi-drive` from the Claude skill picker, or describe the mission in
natural language. Both paths dispatch the same lifecycle helper sequence.

Example:

> `$roi-drive` Refactor the user authentication module to support OAuth

Use `$roi-go` when the workflow owes concrete product-repo implementation
and verification evidence.

---

## Common gotchas

**Skill install must be current.** If `$roi-drive` does not appear in the
picker, re-run `scripts/install-agent-skills.sh claude-user` and restart
Claude Code.

**SQLite single-writer.** Only one Claude Code session should write to the
same ROI database at a time. Set `ROI_SQLITE_PATH` for isolated sessions.

**`verify_gate` pause is intentional.** When a run pauses with
`next_actions: [roi:review]`, the workflow is waiting for an explicit
verdict, not another draft.

See [troubleshooting.md](./troubleshooting.md) and [faq.md](./faq.md) for
the longer operational notes.
