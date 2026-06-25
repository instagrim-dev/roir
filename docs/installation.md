# Installation

> **Coming from Compound Engineering skills?** See the
> [CE → ROI migration guide](./from-ce.md) — it covers ROI skill
> registration for Claude Code, Codex, and Copilot CLI, and includes a
> first-mission checklist for each host.

ROI is a **skill-driven** lifecycle. Each `roi:*` command opens a
`SKILL.md` under [`../skills/`](../skills) and shells to
`node scripts/lifecycle.mjs <verb>` to persist state in local SQLite.
There is no MCP server, daemon, or long-running process to start.

ROI ships as a **local plugin** for OpenAI Codex and GitHub Copilot CLI —
install once and the full `$roi-drive`, `$roi-go`, `$roi-work`, etc.
command surface appears in those hosts' skill pickers alongside
compound-engineering skills. Claude Code uses the same skills via
`scripts/install-agent-skills.sh claude-user`. Cursor gets vocabulary
injection via `.cursor/rules/roi-commands.mdc`. ROI does not ship to any
remote package registry.

## Which Path Should I Use?

| If you have... | Start here |
|---|---|
| A release `roi-plugin-*.tgz` tarball | [Release tarball handoff](#release-tarball-handoff) |
| A local checkout and want a quick backend check | [Verify the lifecycle helper](#verify-the-lifecycle-helper) |
| Cursor | [Open ROI in Cursor](#open-roi-in-cursor) |
| GitHub Copilot CLI | [Add ROI to GitHub Copilot CLI](#add-roi-to-github-copilot-cli) |
| Claude Code | [Install ROI skills into Claude Code](#install-roi-skills-into-claude-code) |
| OpenAI Codex | [OpenAI Codex CLI / Desktop](#openai-codex-cli--desktop) |

## Release Tarball Handoff

If you received a release tarball, verify and unpack it before following a
host setup path:

```bash
shasum -a 256 -c roi-plugin-0.1.1.tgz.sha256
tar -xzf roi-plugin-0.1.1.tgz
cd package
pnpm install --frozen-lockfile
pnpm run release:check
```

The unpacked `package/` directory is the ROI package root for the rest
of this document. Use absolute paths to that root when configuring
host-installed skills.

## Verify The Lifecycle Helper

From the ROI package root (`roi/` checkout or unpacked `package/`
directory):

```bash
pnpm install
pnpm run release:check
node scripts/lifecycle.mjs --list-verbs
```

The third command prints the canonical verb registry (snake_case verbs
that map 1:1 to `ROIService` methods). If it succeeds, the local
backend is healthy and any host can drive it through the installed
skills.

### SQLite location

By default ROI writes `roi.sqlite` under `.data/` in the active ROI
package root. To use a
different file (for example CI or an isolated experiment), set:

```bash
export ROI_SQLITE_PATH=/path/to/roi.sqlite
```

The lifecycle helper picks this up automatically. See also
[`multi-runtime.md`](./multi-runtime.md).

## Open ROI In Cursor

Cursor has no skill picker; the ROI command vocabulary is injected into
every Cursor agent session through `.cursor/rules/roi-commands.mdc`
(shipped in the ROI package root).

### Recommended Cursor Flow

1. Open the ROI package root that ships `.cursor/rules/roi-commands.mdc`
   (either the checked-out `roi/` directory or the unpacked `package/`
   directory).
2. Confirm dependencies are installed under the ROI package root:

   ```bash
   pnpm install
   ```

3. Verify the rule is loaded by asking the agent to run `roi:inspect`
   on a test mission. The agent should open `skills/roi-inspect/SKILL.md`
   and shell to `node scripts/lifecycle.mjs status_get '<args>'`.

### Optional Cursor Rule Install

To install the ROI command-vocabulary rule into `~/.cursor/rules/` for
use outside this package root, run:

```bash
scripts/install-agent-skills.sh cursor-user
```

## Add ROI To GitHub Copilot CLI

GitHub Copilot CLI surfaces ROI through its skill plugin system, not
through MCP. Install the ROI skill plugin so `$roi-drive`, `$roi-go`,
etc. appear in the Copilot skill picker:

```bash
scripts/install-agent-skills.sh copilot
```

This symlinks `skills/` into `~/.copilot/installed-plugins/roi-plugin/`
and registers the plugin in `~/.copilot/settings.json`. Restart
`gh copilot` after running.

### Verifying

In a Copilot CLI session, type `$roi-` and the picker should list every
ROI alias. If it does not:

- check `~/.copilot/installed-plugins/roi-plugin/` exists and resolves
  to this checkout's `skills/` directory
- check `~/.copilot/settings.json` lists `roi-plugin` under installed
  plugins
- restart `gh copilot`

## Install ROI Skills Into Claude Code

Claude Code resolves skills through `~/.claude/skills/` (user-wide) or
`.claude/skills/` (project). Install the ROI skills with:

```bash
scripts/install-agent-skills.sh claude-user
```

That symlinks each `skills/<name>/SKILL.md` into the user-wide skills
directory. After restarting Claude Code, `$roi-drive`, `$roi-go`, etc.
appear in the skill picker.

For a project-scoped install (only this project sees the skills):

```bash
scripts/install-agent-skills.sh claude-project
```

ROI does not require, ship, or recommend a Claude Code MCP server. The
runtime is the lifecycle helper, invoked per-command by each skill.

## OpenAI Codex CLI / Desktop

OpenAI Codex (CLI and IDE extension) surfaces ROI through its plugin
system. Install the ROI skill plugin from the ROI package root:

```bash
scripts/install-agent-skills.sh codex
```

This creates `~/.local/share/roi/plugins/roi/`, generates the required
`~/.local/share/roi/.agents/plugins/marketplace.json`, and registers
the local marketplace in `~/.codex/config.toml`.

After running:

- the **CLI** can use the generated local marketplace immediately;
  `$roi-drive` etc. are visible in the next Codex session
- the **desktop app** requires one manual install step before it caches
  and surfaces the skills:

  Open **Codex.app → Settings (⚙) → Plugins → ROI → Install**, then
  restart the desktop app.

If you add the marketplace manually, use the generated marketplace root
(`~/.local/share/roi`, or its full absolute path if the UI does not
expand `~`) as the local marketplace source and leave **Git ref** and
**Sparse paths** empty. Local marketplace policies must use
`authentication: "ON_INSTALL"` or `authentication: "ON_USE"`; Codex
rejects `authentication: "NONE"`.

### Codex Notes

- Re-run `scripts/install-agent-skills.sh codex` after updating the
  checkout to refresh the symlinks.
- Codex MCP configuration is **not** required for ROI. Earlier ROI
  releases shipped a stdio MCP server; the current runtime is the
  lifecycle helper invoked by each skill.
- Optional: set `ROI_SQLITE_PATH` in your shell environment (or a Codex
  per-project env) to pin the SQLite file. See
  [multi-runtime.md](./multi-runtime.md).

## Persistence

By default, ROI stores state here:

```text
.data/roi.sqlite
```

This file is created automatically when the lifecycle helper first
opens the database.

## Resetting State

To clear local state:

1. Stop any in-flight helper invocations (skills run the helper as a
   short-lived subprocess; nothing long-running persists).
2. Remove `.data/roi.sqlite` and its WAL sidecars.

```bash
rm -f .data/roi.sqlite .data/roi.sqlite-wal .data/roi.sqlite-shm
```

Do not remove the database while a helper invocation is mid-write.

## What Is Supported

Supported:

- skill-driven `roi:*` command vocabulary across Cursor, Codex, Copilot
  CLI, and Claude Code
- lifecycle helper (`scripts/lifecycle.mjs`) as the canonical persistence
  path
- local SQLite persistence
- local workflow execution
- bounded A2A delegation when a compatible remote peer is available

Not supported:

- bundled stdio MCP server (removed in this release; was in earlier ROI
  versions)
- remote package registry distribution
- hosted ROI backend
- multi-user deployment guidance
- production-grade auth, tenancy, or hardened secrets management

## Next Docs

- [`quickstart.md`](./quickstart.md)
- [`architecture.md`](./architecture.md)
- [`limitations.md`](./limitations.md)
