# Release Validation

This document defines what must be true before ROI can be handed to another
maintainer as a private distributable artifact.

## Publishing Contract

ROI v0.1 is a **private local-first package**, not a public or private registry
publication.

The supported private artifacts are:

- a checked-out `roi/` directory with dependencies installed through `pnpm`
- a package tarball produced by `pnpm pack --pack-destination <dir>`
- local host wiring produced from the checkout by `scripts/install-agent-skills.sh`

`package.json` remains `"private": true` on purpose. That prevents accidental
registry publication while still allowing `pnpm pack` for private handoff and
release validation.

## Receiving A Tarball

When a maintainer receives `roi-plugin-*.tgz`, they should verify, unpack, and
run the release gate before wiring any host to the package:

```bash
shasum -a 256 -c roi-plugin-0.1.0.tgz.sha256
tar -xzf roi-plugin-0.1.0.tgz
cd package
pnpm install --frozen-lockfile
pnpm run release:check
```

If the handoff did not include a `.sha256` file, ask the producer for one
instead of trusting the tarball by filename alone.

## Release Gate

ROI is not ready to distribute until all of these pass:

- Node runtime check and MCP tool manifest parity
- full test suite
- MCP startup smoke
- integration smoke for the ergonomic command tools
- installer dry-runs for Claude, Codex, and Copilot
- Codex marketplace metadata validation
- production dependency audit
- package tarball allowlist inspection

Run the full gate from the ROI package root (`roi/` checkout or unpacked
`package/` directory):

```bash
pnpm run release:check
```

## Validation Lanes

### 1. Packaging Validation

- The tarball is produced with pnpm.
- The tarball does not contain workspace residue:
  - `bmo-import/`
  - `artifacts/`
  - `.data/`
  - `node_modules/`
  - `package-lock.json`
- The tarball includes the runtime and validation surfaces required for private
  handoff:
  - `src/`
  - `skills/`
  - `agents/`
  - `hooks/`
  - `docs/`
  - `fixtures/`
  - `scripts/`
  - `pnpm-lock.yaml`

### 2. Contract Validation

- MCP tool names in `fixtures/mcp-tools.json` match `src/server.mjs`.
- The ergonomic command tools are discoverable over MCP:
  - `mission_create`
  - `mission_list`
  - `status_get`
  - `plan_generate`
  - `run_create`
  - `run_cancel`
  - `verify_evaluate`
  - `evidence_record`
  - `evidence_list`
  - `brief_revise`
  - `enlighten_run`

### 3. Workflow Validation

The test suite must prove:

- work-through-outline flow reaches executable plans
- outline-to-draft flow creates bounded runs
- draft-to-review flow records evidence
- review-to-publish or review-to-edit next actions are deterministic
- learning either proposes a capability or returns an auditable no-promotion
  outcome

### 4. Recovery Validation

The test suite must prove:

- paused runs can resume from durable state
- blocked tasks preserve blocking reason and checkpoint refs
- stale convergence seams are rejected instead of resumed silently
- completed runs resume as no-op

### 5. Trace And Policy Validation

The test suite must prove:

- mutating runs emit inspectable traces
- policy denials block before workflow execution
- policy denials remain inspectable and non-destructive

### 6. Security And Dependency Validation

`pnpm audit --prod` must report no known vulnerabilities before a private
package handoff.

If this ever becomes impossible because of an unpatched transitive dependency,
the release must stop until `SECURITY.md` or release notes record the exact
accepted residual risk and why it is not reachable in ROI's supported local
stdio mode.

### 7. Marketplace Validation

The checked-in Codex marketplace manifest and the Codex installer-generated
manifest must agree on the local marketplace identity and supported auth policy:

- marketplace name: `roi-plugin`
- plugin name: `roi`
- installation policy: `AVAILABLE`
- authentication policy: `ON_INSTALL`

`authentication: "NONE"` is not valid for the current Codex local marketplace
path and must fail `pnpm run release:check`.

## Runtime Constraints

Release notes and handoff instructions must preserve these v0.1 constraints:

- Node.js `>=24`
- pnpm-only dependency management
- local SQLite persistence
- Node's experimental `node:sqlite` API
- reset-not-migrate schema handling
- local-first MCP stdio runtime, not a hosted control plane
- human-gated capability promotion

## Principle

If a release cannot prove bounded package contents, durable state,
resumability, inspectability, and clean dependency posture, it is not yet a
credible ROI private release.
