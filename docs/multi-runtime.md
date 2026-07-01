# Multi-runtime install matrix

ROI ships one **lifecycle helper** (`scripts/lifecycle.mjs`) and one
**SQLite system of record**. Hosts differ only by how they install the
ROI skills (or, for Cursor, inject the command vocabulary)—not by ROI
business logic. There is no MCP server, daemon, or long-running process.

**Support tier**

- **Tier 1** — Documented here for **Claude Code, Cursor, GitHub Copilot
  CLI, and OpenAI Codex**; validation runs `pnpm run release:check`
  from the ROI package root on Node 24.x (same backend for every row).

| Runtime | Skill install | Command surface | Validation | Env / path assumptions | Tier | Notes |
|---------|---------------|-----------------|------------|------------------------|------|-------|
| **OpenAI Codex** | `scripts/install-agent-skills.sh codex` writes `~/.local/share/roi/plugins/roi/` and registers the local marketplace in `~/.codex/config.toml` | `$roi-drive`, `$roi-go`, `$roi-work`, … from the Codex skill picker | `pnpm run release:check` | ROI package root must remain reachable from the symlinks the installer creates | 1 | Desktop app also requires **Codex.app → Settings → Plugins → ROI → Install** after updates so its plugin cache sees refreshed skills. See [installation.md](./installation.md). |
| **Claude Code** | `scripts/install-agent-skills.sh claude-user` (or `claude-project`) symlinks each `skills/<name>/SKILL.md` into `~/.claude/skills/` | `$roi-drive`, `$roi-go`, `$roi-work`, … from the Claude Code skill picker | `pnpm run release:check` | ROI package root reachable from `~/.claude/skills/` symlinks | 1 | Primary reference host for skills/agents; see [installation.md](./installation.md). |
| **Cursor** | No skill install required; vocabulary loads via `.cursor/rules/roi-commands.mdc` at the ROI package root. Optional `scripts/install-agent-skills.sh cursor-user` installs the same rule into `~/.cursor/rules/` | `roi:drive`, `roi:go`, … recognized by the Cursor agent in any session that loads the rule | `pnpm run release:check` | Open the checked-out `roi/` root or unpacked `package/` root so Cursor sees the bundled rule file | 1 | Cursor has no skill picker; rules document the surface to every agent session. |
| **GitHub Copilot CLI** | `scripts/install-agent-skills.sh copilot` symlinks `skills/` into `~/.copilot/installed-plugins/roi-plugin/` and registers the plugin in `~/.copilot/settings.json` | `$roi-drive`, `$roi-go`, … from the Copilot skill picker | `pnpm run release:check` | ROI package root reachable from the installed-plugins symlink | 1 | Re-run after moving the checkout to refresh symlinks. |

## Environment

- **`ROI_SQLITE_PATH`** — Optional. When set, the lifecycle helper uses
  this file for SQLite instead of `.data/roi.sqlite` under the ROI
  package root. Use for CI smoke tests or isolated experiments so you do
  not lock the developer database. Skills inherit the variable from the
  shell that invokes them.

## Windows

Use pnpm from a Node `>=24` shell. Use forward slashes in JSON configs
or escaped backslashes. If a host fails to resolve a skill, ensure the
ROI package root is reachable from the symlink (or rule file) the
installer created and that `node` is on `PATH`.

## Related

- [installation.md](./installation.md) — step-by-step per host
- [command-reference.md](./command-reference.md) — `roi:*` ↔ lifecycle verbs
- [limitations.md](./limitations.md) — SQLite locking and single-writer notes
