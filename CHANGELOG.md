# Changelog

## 0.1.0

- **MCP tool ids (2026-04-22):** Tool **`name`** values use **underscores** (e.g. `mission_create`, `enlighten_run`) so strict hosts (e.g. **Cursor**) accept them; logical dotted ids remain the MCP **title**. Update `callTool` and hard-coded tool lists.
- published the ROI v0.1 reference package structure
- documented the full user-facing command surface
- added quickstart, installation, architecture, state, limitations,
  troubleshooting, and FAQ docs
- added OSS hygiene docs for license, contributing, and security
- aligned user-facing terminology on `enlighten` / `enlightenment`
- **MCP:** compounding pass is **`enlighten.run`** only (maps to `roi:enlighten` /
  `service.enlightenRun`)
- **`ROI_SQLITE_PATH`** env var selects the SQLite file (default remains
  `.data/roi.sqlite` under `roi/`)
- **`fixtures/mcp-tools.json`** + `npm run validate` / `sync:mcp-tools` for tool
  manifest parity; **`npm run smoke`** for stdio MCP subprocess check (CI)
- added [`docs/multi-runtime.md`](docs/multi-runtime.md) install matrix (includes **OpenAI Codex** as Tier 1 with [`codex/config.snippet.toml`](codex/config.snippet.toml))
- product naming: user command for the enlightenment / compounding pass is **`roi:enlighten`**
