# ROI installer payload — GitHub Copilot CLI

ROI is a **skill-driven** lifecycle. There is no MCP server to register.
This directory provides context-injection content that teaches Copilot
CLI the ROI vocabulary and helper-verb surface.

## Install

Append `instructions.md.snippet` to your repo's
`.github/copilot-instructions.md` (or merge into the project's existing
Copilot instructions file):

```bash
cat /absolute/path/to/roi-checkout/copilot/instructions.md.snippet >> .github/copilot-instructions.md
```

## Verify

After Copilot picks up the instructions, run a smoke:

```
roi:inspect <mission_id>
```

Copilot should open `roi/skills/roi-inspect/SKILL.md` and shell to
`node roi/scripts/lifecycle.mjs status_get` per the skill procedure.

For deeper verification of the helper itself:

```bash
node /absolute/path/to/roi-checkout/scripts/integration-smoke.mjs
```

## Migration from the MCP installer

If you previously installed ROI via `mcp-config.json` referencing
`src/server.mjs`, remove that block — there is no MCP server anymore.
Skills shell directly to `roi/scripts/lifecycle.mjs`. The SQLite database
location (`roi/.data/roi.sqlite` or `ROI_SQLITE_PATH`) is unchanged, so
existing missions remain intact.
