# ROI installer payload — OpenAI Codex CLI

ROI is a **skill-driven** lifecycle. There is no MCP server to register.
This directory provides context-injection content that teaches Codex the
ROI vocabulary and helper-verb surface.

## Install

Copy `AGENTS.md.snippet` into your trusted-project root or merge it into
your existing `~/.codex/AGENTS.md`:

```bash
cat /absolute/path/to/roi-checkout/codex/AGENTS.md.snippet >> ~/.codex/AGENTS.md
```

For per-project scoping, copy into `<project>/.codex/AGENTS.md` instead.

## Verify

After Codex picks up the AGENTS.md content, run a smoke from any Codex
session:

```
roi:inspect <mission_id>
```

Codex should open `roi/skills/roi-inspect/SKILL.md` and shell to
`node roi/scripts/lifecycle.mjs status_get` per the skill procedure.

For deeper verification of the helper itself:

```bash
node /absolute/path/to/roi-checkout/scripts/integration-smoke.mjs
```

## Migration from the MCP installer

If you previously installed ROI via `~/.codex/config.toml` with
`[mcp_servers.roi]`, remove that block — there is no MCP server anymore.
Skills shell directly to `roi/scripts/lifecycle.mjs`. The SQLite database
location (`roi/.data/roi.sqlite` or `ROI_SQLITE_PATH`) is unchanged, so
existing missions remain intact.
