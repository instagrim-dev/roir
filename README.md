# ROI Rogers

ROI Rogers is an operating model for **Reusable Operational Intelligence**: an
agent-native way to run software delivery through durable missions, plans,
runs, reviews, evidence, and reusable capabilities instead of chat-only state.

The current package ships with:

- a bundled stdio MCP server
- a local SQLite system of record
- command-oriented skills for `roi:work` through `roi:inspect`
- agent descriptors, hook scripts, and A2A-aware execution paths

## What ROI Is

ROI is designed to show one concrete answer to this question:

How should an agentic software delivery system store work, route execution,
pause safely, verify output, and turn repeated success into reusable
capabilities?

That makes this repository useful in two ways:

- as a clear operating model for agent-native delivery
- as a working implementation you can run and inspect directly

## What ROI Is Not

ROI v0.1 is intentionally narrow.

- It is not a hosted control plane.
- It is not distributed via a remote package registry.
- It is not production-hardened for high-trust environments.
- It does not depend on the rest of the BMO codebase at runtime.

## Audience

ROI is for people who want to:

- use or adapt a concrete artifact-native workflow engine
- experiment with local MCP-backed agent workflows
- explore review-gated execution, resumability, and reusable capability
  promotion
- build delivery systems that improve with use

## Prerequisites

- Node.js `>=24`
- pnpm
- A local checkout of this `roi/` directory, or a private `roi-plugin-*.tgz`
  handoff tarball
- Optional: Cursor for project-local MCP usage
- Optional: GitHub Copilot CLI
- Optional: a Claude Code environment for local MCP wiring
- Optional: a remote A2A-compatible peer if you want to exercise the remote
  execution path

## Quick Start

Choose the path that matches what you have.

### If You Received A Private Tarball

```bash
shasum -a 256 -c roi-plugin-0.1.0.tgz.sha256
tar -xzf roi-plugin-0.1.0.tgz
cd package
pnpm install --frozen-lockfile
pnpm run release:check
```

After validation, wire the unpacked package into your host with
[`docs/installation.md`](./docs/installation.md).

### If You Have A Checkout

1. Install dependencies from `roi/`.

   ```bash
   pnpm install
   ```

2. Run the release gate.

   ```bash
   pnpm run release:check
   ```

   For a shorter local check, use `pnpm test` or `pnpm run smoke`.

3. Choose a host integration.

   Most users should let Cursor, Codex, Copilot CLI, or Claude Code spawn the
   stdio MCP server. Run `pnpm start` only when you want to debug the server
   directly from a terminal.

4. Start with the zero-friction command:

   `roi:go [mission]` then `roi:drive [mission]` (implement, then lifecycle)

   The manual lifecycle remains available when you want step-by-step control:

   `roi:work -> roi:brief -> roi:source -> roi:outline -> roi:draft -> roi:review -> roi:edit -> roi:publish -> roi:learn -> roi:inspect`

   Convergence missions can additionally declare a maturity ladder plus a
   seam manifest, letting ROI elect one active seam at a time and carry
   publish-driven progress forward across multiple bounded runs.

The canonical sample mission lives at
[`fixtures/reference-mission.json`](./fixtures/reference-mission.json).

## Commands

The top-level ROI command surface is:

- `roi:go` — implement plans in the product repo and record verification evidence
- `roi:drive` — ROI lifecycle driver (runs, verify gate, publish)
- `roi:work`
- `roi:brief`
- `roi:source`
- `roi:outline`
- `roi:draft`
- `roi:review`
- `roi:edit`
- `roi:publish`
- `roi:learn`
- `roi:inspect`
- `roi:cancel`

See [`docs/command-reference.md`](./docs/command-reference.md) for the user
contract behind each command, including which commands are direct wrappers over
single MCP operations and which ones are compound client-side flows.

## Runtime Model

- `pnpm start` launches the ROI stdio MCP server from `src/server.mjs`.
- ROI persists state locally in `.data/roi.sqlite` by default.
- `roi:draft` can execute locally or pause on remote A2A work.
- convergence missions bind one active seam to one executable plan at a time
- `roi:review` is the required quality gate before a run is considered ready.
- `roi:edit` and `roi:publish` are compound skill-layer commands over the same
  durable backend, not new MCP tool ids.
- publication evidence on a convergence mission finalizes parent progress and
  re-elects the next seam through the backend state model
- `roi:learn` proposes reusable capabilities but does not promote them
  automatically.

## Local Integration

ROI includes local integration files for:

- [`.cursor/mcp.json`](./.cursor/mcp.json)
- [`copilot/mcp-config.json`](./copilot/mcp-config.json)
- [`codex/config.snippet.toml`](./codex/config.snippet.toml) (OpenAI Codex CLI / IDE)
- [`plugin.json`](./plugin.json)
- [`mcp.json`](./mcp.json)
- [`skills/`](./skills)
- [`agents/`](./agents)
- [`hooks/`](./hooks)

These files expose ROI's command surface and runtime behavior in a local host
environment.

**Skill plugin install (surfaces `$roi-drive`, `$roi-go`, etc. in the host skill picker):**

```bash
# Codex — adds to ~/.local/share/roi/ and ~/.codex/config.toml
roi/scripts/install-agent-skills.sh codex

# Copilot CLI — adds to ~/.copilot/installed-plugins/ and ~/.copilot/settings.json
roi/scripts/install-agent-skills.sh copilot

# Claude Code (user-wide)
roi/scripts/install-agent-skills.sh claude-user
```

Cursor gets vocabulary injection via `.cursor/rules/roi-commands.mdc` (already
checked in); no separate skill-install step required.

OpenAI Codex and GitHub Copilot CLI users should also register the MCP server
entry — see [`docs/installation.md`](./docs/installation.md).

This release documents ROI as a private local-first package. See
[`docs/installation.md`](./docs/installation.md) for setup and
[`docs/release-validation.md`](./docs/release-validation.md) for the private
tarball handoff contract.

## Documentation

- [`docs/multi-runtime.md`](./docs/multi-runtime.md) — Codex, Claude Code, Cursor, Copilot CLI, generic MCP
- [`docs/quickstart.md`](./docs/quickstart.md)
- [`docs/installation.md`](./docs/installation.md)
- [`docs/release-validation.md`](./docs/release-validation.md)
- [`docs/command-reference.md`](./docs/command-reference.md)
- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/state-and-artifacts.md`](./docs/state-and-artifacts.md)
- [`docs/limitations.md`](./docs/limitations.md)
- [`docs/troubleshooting.md`](./docs/troubleshooting.md)
- [`docs/faq.md`](./docs/faq.md)
- [`examples/software-engineer-workflows.md`](./examples/software-engineer-workflows.md)

## Open Source Basics

- [`LICENSE`](./LICENSE)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`SECURITY.md`](./SECURITY.md)
- [`CHANGELOG.md`](./CHANGELOG.md)

## Current Limitations

The biggest current constraints are:

- local SQLite only
- Node's experimental `node:sqlite` API
- no hosted orchestration plane
- no remote package registry distribution
- human-gated capability promotion
- bounded A2A support rather than a general remote-agent fabric

Read [`docs/limitations.md`](./docs/limitations.md) before treating ROI as
anything more than an early ROI release.
