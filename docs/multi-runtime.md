# Multi-runtime install matrix

ROI ships one **stdio MCP server** (`src/server.mjs`) and one **SQLite system of
record**. Hosts differ only by how they spawn the process, working directory, and
config path—not by ROI business logic.

**Support tier**

- **Tier 1** — Documented here for **Claude Code, Cursor, GitHub Copilot CLI,
  OpenAI Codex, and generic MCP**; validation runs `pnpm run release:check`
  from the ROI package root on Node 24.x (same backend for every row).

| Runtime | MCP entry | Packaged skills / commands | CI / validation | Env / path assumptions | Tier | Notes |
|--------|-----------|----------------------------|-----------------|------------------------|------|-------|
| **OpenAI Codex** | `~/.codex/config.toml` or project `.codex/config.toml`; `[mcp_servers.roi]` stdio | MCP tools; optional `roi` skills via package checkout | `pnpm run release:check` | Absolute `node` + `src/server.mjs`; set `cwd` to ROI package root | 1 | Template + steps: [`codex/config.snippet.toml`](../codex/config.snippet.toml), [installation.md](./installation.md) Option 5. CLI: `codex mcp ...`. |
| **Claude Code** | stdio `node src/server.mjs` | `plugin.json`, `skills/`, `agents/`, `hooks/` | `pnpm run release:check` | Absolute path to ROI package root | 1 | Primary reference host for skills/agents; see [installation.md](./installation.md). |
| **Cursor** | Project [`.cursor/mcp.json`](../.cursor/mcp.json) | MCP tools (no bundled skills in Cursor) | `pnpm run release:check` | Open ROI package root as workspace so `${workspaceFolder}` resolves | 1 | MCP-only; command vocabulary comes from `.cursor/rules/roi-commands.mdc`. |
| **GitHub Copilot CLI** | User `~/.copilot/mcp-config.json` (see Copilot CLI MCP docs) | MCP tools plus local ROI skills | `pnpm run release:check` | User-edited **absolute** path to `src/server.mjs` | 1 | Template: [`copilot/mcp-config.json`](../copilot/mcp-config.json). |
| **Generic MCP client** | stdio, any spec-compliant host | N/A | `pnpm run smoke` | `cwd` = ROI package root, command `node src/server.mjs` | 1 | Catch-all for hosts not listed above. |

## Environment

- **`ROI_SQLITE_PATH`** — Optional. When set, the server uses this file for SQLite
  instead of `.data/roi.sqlite` under the ROI package root. Use for CI smoke
  tests or isolated experiments so you do not lock the developer database.

## Windows

Use pnpm from a Node `>=24` shell. Use forward slashes in JSON configs or
escaped backslashes. If a host fails to resolve paths, use an absolute
`server.mjs` path and set the working directory to the ROI package root.

## Related

- [installation.md](./installation.md) — step-by-step per host
- [command-reference.md](./command-reference.md) — `roi:*` ↔ MCP tool names
- [limitations.md](./limitations.md) — SQLite locking and single-writer notes
