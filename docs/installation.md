# Installation

> **Coming from Compound Engineering skills?** See the
> [CE → ROI migration guide](./from-ce.md) — it covers MCP registration for
> Claude Code, Codex, and Copilot CLI in the context of migrating from CE
> workflows, and includes a first-mission checklist for each host.

ROI supports two usage modes:

- run it directly as a local MCP-backed ROI runtime
- wire it into a host via ROI's MCP server, skill plugin, agents, and hooks

ROI ships as a **local plugin** for OpenAI Codex and GitHub Copilot CLI —
install once and the full `$roi-drive`, `$roi-go`, `$roi-work`, etc. command
surface appears in those hosts' skill pickers alongside compound-engineering
skills. Claude Code uses the same skills via `plugin.json`. Cursor gets
vocabulary injection via `.cursor/rules/roi-commands.mdc`. It does not ship to
any remote package registry.

## Which Path Should I Use?

| If you have... | Start here |
|---|---|
| A private `roi-plugin-*.tgz` handoff | [Private tarball handoff](#private-tarball-handoff) |
| A local checkout and want a quick backend check | [Run ROI directly](#option-1-run-roi-directly) |
| Cursor | [Open ROI in Cursor](#option-2-open-roi-in-cursor) |
| GitHub Copilot CLI | [Add ROI to GitHub Copilot CLI](#option-3-add-roi-to-github-copilot-cli) |
| Claude Code | [Connect ROI to Claude Code through MCP](#option-4-connect-roi-to-claude-code-through-mcp) |
| OpenAI Codex | [OpenAI Codex CLI](#option-5-openai-codex-cli) |

## Private Tarball Handoff

If you received a private tarball, verify and unpack it before following a host
setup path:

```bash
shasum -a 256 -c roi-plugin-0.1.0.tgz.sha256
tar -xzf roi-plugin-0.1.0.tgz
cd package
pnpm install --frozen-lockfile
pnpm run release:check
```

The unpacked `package/` directory is the ROI package root for the rest of this
document. Use absolute paths to `package/src/server.mjs` when configuring
user-scoped hosts.

## Option 1: Run ROI Directly

From the ROI package root (`roi/` checkout or unpacked `package/` directory):

```bash
pnpm install
pnpm run release:check
pnpm start
```

This gives you the ROI stdio MCP server and local SQLite persistence.

### SQLite location

By default ROI writes `roi.sqlite` under `roi/.data/`. To use a different file
(for example CI or an isolated experiment), set:

```bash
export ROI_SQLITE_PATH=/path/to/roi.sqlite
```

Then start the server as usual. See also [`multi-runtime.md`](./multi-runtime.md).

## Option 2: Open ROI In Cursor

Cursor supports project-local MCP servers through `.cursor/mcp.json`. ROI ships
that file already:

- [`.cursor/mcp.json`](../.cursor/mcp.json)

### Recommended Cursor Flow

1. Open the ROI package root itself as the Cursor workspace (`roi/` checkout or
   unpacked `package/` directory).
2. Confirm dependencies are installed:

   ```bash
   pnpm install
   ```

3. Let Cursor load the project-local MCP config from `.cursor/mcp.json`.
4. Verify the `roi` MCP server appears in Cursor's MCP tools/settings view.

### Current Cursor Config

ROI's Cursor config uses project-relative interpolation so the server works when
`roi/` is the workspace root:

```json
{
  "mcpServers": {
    "roi": {
      "command": "node",
      "args": ["${workspaceFolder}/src/server.mjs"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

### Cursor Notes

- Open `roi/` directly, not the repo root, if you want the bundled project
  config to work without edits.
- **MCP** is the execution surface. Cursor does not have a native skill-picker
  like Claude Code or Codex. ROI command vocabulary (`roi:drive`, `roi:go`,
  `roi:work`, etc.) is injected into every Cursor agent session via
  `.cursor/rules/roi-commands.mdc` (already checked in to the BMO repo). Agents
  will recognize and dispatch these commands without additional setup.
- To install Cursor command stubs into `~/.cursor/commands/` as well, run
  `scripts/install-agent-skills.sh cursor-user`.

## Option 3: Add ROI To GitHub Copilot CLI

GitHub Copilot CLI supports MCP servers through the user-level config file at
`~/.copilot/mcp-config.json`, or through the interactive `/mcp add` command.
ROI ships a ready-to-copy template:

- [`../copilot/mcp-config.json`](../copilot/mcp-config.json)

### Recommended Copilot Flow

1. Confirm dependencies are installed:

   ```bash
   pnpm install
   ```

2. Register the ROI MCP server using `/mcp add` or the config file (see steps
   below).

3. **Install the ROI skill plugin** so `$roi-drive`, `$roi-go`, etc. appear in
   the Copilot skill picker:

   ```bash
   scripts/install-agent-skills.sh copilot
   ```

   This symlinks `skills/` into `~/.copilot/installed-plugins/roi-plugin/`
   and registers the plugin in `~/.copilot/settings.json`. Restart `gh copilot`
   after running.

4. Verify the `roi` server appears in `/mcp show`.

### Current Copilot Config

ROI's Copilot CLI template uses the MCP format documented for
`~/.copilot/mcp-config.json`:

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

### Copilot Notes

- Copilot CLI stores MCP server config in `~/.copilot/mcp-config.json` by
  default.
- The ROI template uses an absolute path placeholder because Copilot CLI MCP
  config is user-scoped rather than project-scoped.
- The ROI MCP server is local and stdio-based; there is no hosted Copilot
  setup in this package.
- **Skill plugin:** `scripts/install-agent-skills.sh copilot` wires the
  `$roi-*` commands into Copilot's plugin system (mirrors the
  compound-engineering plugin pattern). Re-run after updating the checkout to
  refresh the symlinks.

## Option 4: Connect ROI To Claude Code Through MCP

Claude Code supports local stdio MCP servers through project or user MCP
configuration. ROI ships a ready-to-read MCP config in
[`../mcp.json`](../mcp.json).

### Recommended Local MCP JSON

Use an absolute path to this checkout:

```json
{
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/src/server.mjs"]
}
```

You can register a local server through your preferred Claude Code MCP
workflow, or translate that JSON into a project `.mcp.json` entry.

### Current ROI Integration Assets

ROI includes these Claude-oriented assets:

- [`../plugin.json`](../plugin.json)
- [`../mcp.json`](../mcp.json)
- [`../skills/`](../skills)
- [`../agents/`](../agents)
- [`../hooks/`](../hooks)

Treat them as ROI's local integration files. For installing the reference
`skills/` trees into a Claude Code-style path, use
[`../scripts/install-agent-skills.sh`](../scripts/install-agent-skills.sh).
Run `../scripts/install-agent-skills.sh --help` for supported host targets.

## Option 5: OpenAI Codex CLI

OpenAI Codex (CLI and IDE extension) loads MCP servers from **`~/.codex/config.toml`**
by default, or from **`.codex/config.toml`** in a **trusted** project. The CLI
and extension share the same file—configure once, use both. See OpenAI’s
[Model Context Protocol (Codex)](https://developers.openai.com/codex/mcp) docs
for the full surface.

### Recommended Codex flow

1. Install dependencies under the ROI package root:

   ```bash
   pnpm install
   ```

2. Register the ROI MCP server (choose A or B below).

3. **Install the ROI skill plugin** so `$roi-drive`, `$roi-go`, etc. appear in
   the Codex skill picker alongside `$ce-brainstorm`:

   ```bash
   scripts/install-agent-skills.sh codex
   ```

   This creates `~/.local/share/roi/plugins/roi/`, the required
   `~/.local/share/roi/.agents/plugins/marketplace.json`, and registers the
   plugin in `~/.codex/config.toml`.

4. **Desktop app: click Install in the Plugins page.** The script registers the
   local marketplace, but the Codex desktop app requires one manual Install step
   before it caches the skills and surfaces them in the `$`-picker:

   Open **Codex.app → Settings (⚙) → Plugins → ROI → Install**, then restart.

   > The Codex CLI reads the registered local marketplace from
   > `~/.codex/config.toml` and can use the generated plugin immediately; the
   > desktop app only shows skills that have been installed via the Plugins UI.

   If you add the marketplace manually, use the generated marketplace root
   (`~/.local/share/roi`, or its full absolute path if the UI does not expand
   `~`) as the local marketplace source and leave **Git ref** and
   **Sparse paths** empty. Local marketplace policies must use
   `authentication: "ON_INSTALL"` or `authentication: "ON_USE"`; Codex rejects
   `authentication: "NONE"`.

**A. MCP server via CLI (quick)**

```bash
codex mcp add roi -- node /absolute/path/to/src/server.mjs
```

If you need a working directory or `ROI_SQLITE_PATH`, prefer **B** or edit the
entry Codex writes into `config.toml`.

**B. MCP server via config snippet (full control)**

Copy the checked-in template and merge into `~/.codex/config.toml` (or
`.codex/config.toml`), then replace the placeholder path:

- [`../codex/config.snippet.toml`](../codex/config.snippet.toml)

Minimal shape (after path substitution):

```toml
[mcp_servers.roi]
command = "node"
args = ["/absolute/path/to/src/server.mjs"]
cwd = "/absolute/path/to/roi-package-root"
```

3. Verify:

   ```bash
   codex mcp list
   ```

   In the Codex TUI, **`/mcp`** lists active servers.

### Codex notes

- Use an **absolute** path to `src/server.mjs` (same discipline as Copilot CLI).
- Set **`cwd`** to the ROI package root so relative expectations match other hosts.
- Optional: set **`ROI_SQLITE_PATH`** under `[mcp_servers.roi.env]` in TOML to pin
  the SQLite file (see [multi-runtime.md](./multi-runtime.md)).
- **Skill plugin:** `scripts/install-agent-skills.sh codex` wires the
  `$roi-*` commands into Codex's plugin system (mirrors the compound-engineering
  plugin pattern). Re-run after updating the checkout to refresh the symlinks.
- **Desktop app:** After running the script, open Codex.app → Settings → Plugins
  → ROI → Install to complete the cache step. The CLI can use the generated
  local marketplace immediately; the desktop app only surfaces skills after this
  UI install action.
- **Manual Add Marketplace:** Use the generated local marketplace root
  (`~/.local/share/roi`, or its full absolute path), not the raw checkout path.
  Clear **Git ref** and **Sparse paths** for local marketplace sources.

## Persistence

By default, the server stores state here:

```text
roi/.data/roi.sqlite
```

This file is created automatically when the server first opens the database.

## Resetting State

To clear local state:

1. Stop the server.
2. Remove `.data/roi.sqlite` and its WAL sidecars.

```bash
rm -f .data/roi.sqlite .data/roi.sqlite-wal .data/roi.sqlite-shm
```

Do not remove the database while the server is running.

## What Is Supported

Supported:

- local stdio MCP server startup
- Cursor project-local MCP installation (vocabulary via `.cursor/rules/roi-commands.mdc`)
- GitHub Copilot CLI MCP installation + skill plugin (`$roi-drive`, `$roi-go`, etc.)
- OpenAI Codex CLI / Codex IDE extension MCP + skill plugin (`$roi-drive`, `$roi-go`, etc.)
- Claude Code local MCP wiring + skill plugin (`$roi-drive`, `$roi-go`, etc.)
- local SQLite persistence
- local workflow execution
- bounded A2A delegation when a compatible remote peer is available

Not supported:

- remote package registry distribution
- hosted ROI backend
- multi-user deployment guidance
- production-grade auth, tenancy, or hardened secrets management

## Next Docs

- [`quickstart.md`](./quickstart.md)
- [`architecture.md`](./architecture.md)
- [`limitations.md`](./limitations.md)
