---
name: install-roi-mcp
description: Install ROI MCP into OpenAI Codex, Cursor, GitHub Copilot CLI, or Claude Code using the checked-in host config templates. Use when setting up ROI in a host, updating MCP config, or verifying an ROI installation.
---

# Install ROI MCP

Use this skill when the user wants ROI available inside OpenAI Codex, Cursor,
GitHub Copilot CLI, or Claude Code.

If the user explicitly asks you to verify that this skill is active, begin the
response with `ROI_INSTALL_SKILL_ACTIVE`.

## Workflow

1. Detect the target host: OpenAI Codex, Cursor, GitHub Copilot CLI, or Claude Code.
2. Find the ROI checkout path before writing config.
3. Prefer the checked-in ROI host templates over inventing config from scratch.
4. Preserve existing host config and merge the ROI server entry instead of
   replacing unrelated servers.
5. Use an absolute path to `src/server.mjs` unless the host clearly supports a
   project-local workspace-relative config.
6. Verify the result by checking the written config and, when practical,
   confirming the host can discover the ROI MCP server.

## Host Paths

### OpenAI Codex (CLI + IDE extension)

**MCP server** (tool access):
- Template: `roi/codex/config.snippet.toml`
- User config: `~/.codex/config.toml`

Merge the `[mcp_servers.roi]` table from the snippet after substituting absolute
paths to `roi/`. Alternatively, run:

```bash
codex mcp add roi -- node /absolute/path/to/src/server.mjs
```

**Skill commands** (`$roi-drive`, `$roi-go`, etc. in the Codex slash picker):

```bash
roi/scripts/install-agent-skills.sh codex
```

This creates `~/.local/share/roi/plugins/roi/` with the correct
`~/.local/share/roi/.agents/plugins/marketplace.json` required by the Codex
desktop app, and registers `[marketplaces.roi-plugin]` +
`[plugins."roi@roi-plugin"]` in `~/.codex/config.toml`.

**Two-step activation for the desktop app:**

1. Run the script above (registers the local marketplace).
2. Open the Codex desktop app → Settings (⚙) → Plugins → find **ROI** →
   click **Install**. Skills appear in `$`-picker after restart.

> **Why two steps?** The Codex CLI reads `~/.codex/skills/` directly, but the
> desktop app requires a plugin to be explicitly installed via the UI before it
> caches the skills in `~/.codex/plugins/cache/` and surfaces them in the picker.

### Cursor

**MCP server**:
- Project-local template: `roi/.cursor/mcp.json`
- User-global config: `~/.cursor/mcp.json`

```json
{
  "command": "node",
  "args": ["/absolute/path/to/src/server.mjs"],
  "cwd": "/absolute/path/to/roi"
}
```

Cursor does not have a native skill-picker like Claude Code or Codex. ROI
command vocabulary is injected via `.cursor/rules/roi-commands.mdc` (already
checked in); agents will recognize `roi:drive`, `roi:go`, etc. from the rule.

### GitHub Copilot CLI

**MCP server**:
- Template: `roi/copilot/mcp-config.json`
- User config: `~/.copilot/mcp-config.json`

**Skill commands** (`$roi-drive`, `$roi-go`, etc. in the Copilot skill picker):

```bash
roi/scripts/install-agent-skills.sh copilot
```

This creates `~/.copilot/installed-plugins/roi-plugin/roi/` and adds
`roi-plugin` to `extraKnownMarketplaces` + `enabledPlugins` in
`~/.copilot/settings.json`. Restart `gh copilot` after running.

### Claude Code

**MCP server**:
- Template: `roi/mcp.json`

**Skill commands** (`$roi-drive`, `$roi-go`, etc.):

```bash
roi/scripts/install-agent-skills.sh claude-user
```

or for project scope:

```bash
roi/scripts/install-agent-skills.sh claude-project
```

## Verification

After installation:

1. Confirm the target config file contains the `roi` server entry.
2. Confirm the configured `node` command and ROI server path exist.
3. If verifying Cursor specifically, check that Cursor is running and that the
   installed config remains valid JSON. **Tool names** in the ROI server use
   **underscores** (e.g. `mission_create`, not `mission.create`) — Cursor’s MCP
   validator requires `[A-Za-z0-9_]` only. Use those ids in `callTool` and the
   Tools panel; dotted forms may appear as **titles** only.
4. Report the exact file changed and the exact ROI server entry that was
   installed.

## Guardrails

- Never overwrite unrelated MCP servers.
- Never leave placeholder absolute paths in a user config.
- If the ROI checkout path is ambiguous, resolve it before writing config.
- If verification cannot confirm host discovery directly, say so and report the
  strongest verification completed.
