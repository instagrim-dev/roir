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
- **`ROI_PRODUCT_TREES`** — Optional. JSON array of product-tree
  descriptors registered in addition to the built-in `bmo`/`roi` trees.
  See [Product trees](#product-trees).

## Product trees

A **product tree** is a repository subtree that `roi:go`/`roi:verify`
prove implementation against: it governs the `paths_touched` prefix, the
`product_tree` selector on `evidence_record`, the working directory an
oracle runs in, and the optional git-porcelain cross-check.

ROI ships two built-in trees for the `agent-cli/` container layout:

| Key | Subdir | Oracle cwd |
|-----|--------|-----------|
| `roi` | `roi/` (the package itself) | ROI package root |
| `bmo` | sibling `bmo/` | workspace root (`cd bmo && …` self-locates) |

To drive **any other project** on a fresh checkout, register extra trees
without editing source. Precedence is built-ins < `roi.config.json` <
`ROI_PRODUCT_TREES` (later wins by key; built-in `subdir`/`cwd` may be
overridden but the keys cannot be removed).

**`roi.config.json`** at the workspace root (the parent of the `roi/`
package):

```json
{
  "product_trees": [
    { "key": "core", "subdir": "core", "cwd": "self" },
    { "key": "api", "subdir": "services/api", "cwd": "self" }
  ]
}
```

**`ROI_PRODUCT_TREES`** env var — the same array inline (useful in CI):

```bash
export ROI_PRODUCT_TREES='[{"key":"core","subdir":"core","cwd":"self"}]'
```

Descriptor fields:

- **`key`** (required) — lowercase `paths_touched` prefix and
  `product_tree` value (`^[a-z0-9][a-z0-9._-]*$`).
- **`subdir`** (optional, default = `key`) — path under the workspace
  root; may be nested (`services/api`). Absolute paths and `..` segments
  are rejected.
- **`cwd`** (optional, default `self`) — where oracles for this tree run:
  `self` (the tree's own subdir), `workspace` (workspace root), or
  `package` (the ROI package root).

**Recommended layout:** check ROI out **as a sibling of the product
tree(s)** (e.g. `<project>/roi/` next to `<project>/core/`) so
`paths_touched`, oracle cwd, and porcelain checks resolve against the
right directories. A verification target then reads naturally, e.g.
`cd core && bash scripts/test.sh` or `cd services/api && npm run test:unit`
(oracle binaries `bash`/`sh` are allowlisted for gate scripts).

Unknown `product_tree` keys are rejected at `evidence_record` with an
error listing the registered keys.

## Windows

Use pnpm from a Node `>=24` shell. Use forward slashes in JSON configs
or escaped backslashes. If a host fails to resolve a skill, ensure the
ROI package root is reachable from the symlink (or rule file) the
installer created and that `node` is on `PATH`.

## Related

- [installation.md](./installation.md) — step-by-step per host
- [command-reference.md](./command-reference.md) — `roi:*` ↔ lifecycle verbs
- [limitations.md](./limitations.md) — SQLite locking and single-writer notes
