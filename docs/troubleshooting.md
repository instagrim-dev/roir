# Troubleshooting

## `pnpm test` Fails Immediately

Check:

- Node version is `>=24`
- dependencies are installed with `pnpm install`
- you are running commands from the ROI package root (`roi/` checkout or
  unpacked `package/` directory)

## MCP Server Does Not Start

Check:

- `pnpm start` is being run from the ROI package root
- `node` is available on your `PATH`
- no other process has locked the local SQLite file unexpectedly

## Cursor Does Not Detect The ROI Server

Check:

- you opened the ROI package root itself as the Cursor workspace
- `.cursor/mcp.json` exists in that workspace
- `node` is available on your `PATH`
- dependencies were installed with `pnpm install`

If you opened the parent repo instead of the ROI package root, Cursor will not
resolve the project-local `${workspaceFolder}` paths the way this package
expects.

## Copilot Does Not Detect The ROI Server

Check:

- `~/.copilot/mcp-config.json` includes the `roi` server
- the server path in that config points to your local `src/server.mjs`
- `node` is available on your `PATH`
- dependencies were installed with `pnpm install`
- you are using GitHub Copilot CLI, not VS Code Copilot

If you copied the template without replacing the placeholder path, Copilot CLI
will not be able to start the ROI server.

## Codex Does Not List The ROI Server

Check:

- **`codex mcp list`** shows `roi`, or `~/.codex/config.toml` (or project `.codex/config.toml`) contains `[mcp_servers.roi]` with an absolute path to `src/server.mjs`
- **`cwd`** in TOML points at your ROI package root when you use the [`codex/config.snippet.toml`](../codex/config.snippet.toml) template
- the project is **trusted** if you rely on `.codex/config.toml` in-repo (Codex only loads project MCP config for trusted projects)
- `node` is on your `PATH` and dependencies are installed with `pnpm install` under the ROI package root

See [installation.md](./installation.md) Option 5 and OpenAI’s [Codex MCP](https://developers.openai.com/codex/mcp) docs.

## Codex Desktop Fails To Add The ROI Marketplace

If Codex.app shows **Failed to add marketplace** for ROI, check the local
marketplace package rather than the MCP server:

- use the generated marketplace root as the source:
  `~/.local/share/roi` (enter the full absolute path if the UI does not expand
  `~`)
- do not use the raw checkout path unless its `.agents/plugins/marketplace.json`
  is also current
- clear **Git ref** and **Sparse paths** in the Add Marketplace dialog for local
  marketplace paths; `--ref` only applies to Git marketplace sources
- ensure `.agents/plugins/marketplace.json` uses a supported authentication
  policy: Codex accepts `ON_INSTALL` or `ON_USE`, not `NONE`
- after `scripts/install-agent-skills.sh codex`, `~/.codex/config.toml` should
  contain `[marketplaces.roi-plugin]` with `source` pointing at that generated
  marketplace root and `[plugins."roi@roi-plugin"] enabled = true`

For opaque UI failures, inspect the desktop log under
`~/Library/Logs/com.openai.codex/YYYY/MM/DD/`; `marketplace/add` entries include
the underlying parse or source-format error.

## You See An Experimental SQLite Warning

That is expected in the current release. ROI uses Node's experimental
`node:sqlite` API. This warning does not by itself indicate failure.

## A Run Stops At Review

This is normal. `roi:draft` typically pauses at `verify_gate`. Use:

- `roi:inspect` to inspect the paused state
- `roi:review` to record the verdict and decide whether to edit or publish

## A Run Is Blocked By Policy

Use `roi:inspect` and inspect the stored policy decision and blocked task state.
Common causes include destructive or approval-sensitive actions.

## A Run Is Stuck In `waiting_on_external`

This usually means the A2A path has not yet delivered a reconciled result back
to local ROI state. Retry with `roi:draft` or inspect the remote side if you are
testing bounded A2A delegation.

## `roi:learn` Returns `noop`

That is expected unless ROI has enough repeated successful activations with
passing reviews to justify a capability proposal.

## State Looks Wrong During Local Experimentation

Stop the server and inspect or reset. Because the database runs in WAL mode,
always remove the sidecar files along with `roi.sqlite`:

```bash
rm -f .data/roi.sqlite .data/roi.sqlite-wal .data/roi.sqlite-shm
```

Only do this if you intentionally want to discard local mission history.

See [`state-and-artifacts.md` → "Schema And Migrations"](./state-and-artifacts.md#schema-and-migrations)
for the reset-vs-migrate policy and when a schema-version bump requires a
reset rather than a silent restart.
