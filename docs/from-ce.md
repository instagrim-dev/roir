# CE → ROI Migration Guide

ROI replaces the old CE command surface with a skill-driven lifecycle
backed by `scripts/lifecycle.mjs` and local SQLite state. There is no
ROI MCP server to start.

## Choose a host

- [OpenAI Codex](./from-ce-codex.md)
- [Claude Code](./from-ce-claude-code.md)
- [GitHub Copilot CLI](./from-ce-copilot.md)

## Common setup

Run these from the ROI package root (`roi/` checkout or unpacked
`package/` directory):

```bash
pnpm install
pnpm run release:check
```

Then install the host-specific ROI integration:

- Codex: `scripts/install-agent-skills.sh codex`
- Claude Code: `scripts/install-agent-skills.sh claude-user`
- Copilot CLI: `scripts/install-agent-skills.sh copilot`

Cursor does not use a skill picker. Open the ROI package root so Cursor
loads `.cursor/rules/roi-commands.mdc`, or install that same rule
user-wide with `scripts/install-agent-skills.sh cursor-user`.

## Command mapping

The hero entry point is `roi:drive` / `$roi-drive`. It opens or resumes a
mission, advances the lifecycle, and pauses at explicit verify/publish
gates. Use `roi:go` / `$roi-go` for product-repo implementation and
verification evidence.

| CE concept | ROI equivalent |
|------------|----------------|
| `ce-work` / "run the plan" | `roi:drive` |
| implementation step | `roi:go` |
| review / verdict gate | `roi:review` |
| handoff / publish | `roi:publish` |
| inspect state | `roi:inspect` |

See [installation.md](./installation.md) for the full host setup and
[command-reference.md](./command-reference.md) for the lifecycle verb
mapping.
