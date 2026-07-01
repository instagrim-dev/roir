# Release Validation

This document defines what must be true before ROI can be tagged, packaged,
or handed to another maintainer as a distributable artifact. It mirrors what
[`scripts/release-check.mjs`](../scripts/release-check.mjs) actually
executes — keep the two in sync.

## Publishing Contract

ROI v0.1 is a **public-source, local-first package**, not a registry
publication.

The supported release artifacts are:

- a checked-out `roi/` directory with dependencies installed through `pnpm`
- a package tarball produced by `pnpm pack --pack-destination <dir>`
- local host wiring produced from the checkout by
  `scripts/install-agent-skills.sh`

`package.json` remains `"private": true` on purpose. That prevents
accidental registry publication while still allowing `pnpm pack` for
tarball handoff and release validation.

## Receiving A Tarball

When a maintainer receives `roi-plugin-*.tgz`, they should verify, unpack, and
run the release gate before wiring any host to the package:

```bash
shasum -a 256 -c roi-plugin-0.1.1.tgz.sha256
tar -xzf roi-plugin-0.1.1.tgz
cd package
pnpm install --frozen-lockfile
pnpm run release:check
```

If the handoff did not include a `.sha256` file, ask the producer for one
instead of trusting the tarball by filename alone.

## Release Gate

ROI is not ready to distribute until all of these pass (executed in this
order by `pnpm run release:check`):

1. **Lifecycle verb manifest validation** — `pnpm run validate` runs the
   helper's `--list-verbs` and asserts parity with
   `fixtures/lifecycle-verbs.json` and a Node `>=24` engine check.
2. **Codex marketplace contract validation** — checks
   `.agents/plugins/marketplace.json` against the expected name,
   plugin, installation policy (`AVAILABLE`), and authentication policy
   (`ON_INSTALL`); rejects drift between that manifest and the snippet
   produced by `scripts/install-agent-skills.sh`.
3. **Full test suite** — `pnpm test` (Node `--test` runner; covers
   editorial loop, convergence loop, lifecycle helper contract, and
   ROIService unit tests).
4. **Integration smoke** — `pnpm run smoke:integration` drives
   `scripts/lifecycle.mjs` as a subprocess across the canonical phases
   (verb registry, empty database, mission_create / status_get
   round-trip, error paths).
5. **Installer dry-runs** for Claude (`claude-user`), Codex, and Copilot
   skill plugins.
6. **Production dependency audit** — `pnpm audit --prod` must report no
   known vulnerabilities.
7. **Package tarball inspection** — `pnpm pack` produces a tarball; the
   gate enforces that listed paths match an allowlist (no
   `bmo-import/`, `artifacts/`, `.data/`, `node_modules/`, or
   `package-lock.json`) and includes the runtime surfaces required for
   handoff (`src/`, `skills/`, `agents/`, `.cursor/rules/roi-commands.mdc`,
   `hooks/`, `docs/`, `fixtures/`, `scripts/`, `package.json`).
8. **Extracted-package smoke** — the gate unpacks the tarball, installs
   dependencies in the extracted `package/` root with `--no-frozen-lockfile`
   because package tarballs do not carry `pnpm-lock.yaml`, and runs
   `pnpm run smoke:integration` there so package-root assumptions, logical
   `roi/...` `paths_touched`, and helper-verified oracle paths are proven
   from the shipped artifact rather than only the checkout.

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
- The tarball includes the runtime and validation surfaces required for
  handoff:
  - `src/`
  - `skills/`
  - `agents/`
  - `.cursor/rules/roi-commands.mdc`
  - `hooks/`
  - `docs/`
  - `fixtures/`
  - `scripts/`
  - `package.json`

### 2. Contract Validation

- Verb names emitted by `node scripts/lifecycle.mjs --list-verbs` match
  `fixtures/lifecycle-verbs.json`.
- The ergonomic command verbs are present in that registry:
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
- The integration smoke proves the helper's stdout/stderr/exit-code
  contract: pretty-printed JSON on stdout, `lifecycle: <verb> failed:`
  on stderr for service-thrown errors, exit 1 on unknown verbs and
  malformed JSON.
- The integration smoke also proves helper-verified package-root behavior:
  `evidence_record(run_oracles: true)` can execute a local oracle from the
  active ROI package root and validate logical `roi/...` `paths_touched`.

### 3. Workflow Validation

The test suite must prove:

- work-through-outline flow reaches executable plans
- outline-to-draft flow creates bounded runs
- draft-to-review flow records evidence
- review-to-publish or review-to-edit next actions are deterministic
- learning either proposes a capability or returns an auditable
  no-promotion outcome

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

`pnpm audit --prod` must report no known vulnerabilities before a package
handoff.

If this ever becomes impossible because of an unpatched transitive
dependency, the release must stop until `SECURITY.md` or release notes
record the exact accepted residual risk and why it is not reachable in
ROI's supported local mode.

### 7. Marketplace Validation

The checked-in Codex marketplace manifest and the manifest written by
`scripts/install-agent-skills.sh codex` must agree on the local
marketplace identity and supported auth policy:

- marketplace name: `roi-plugin`
- plugin name: `roi`
- installation policy: `AVAILABLE`
- authentication policy: `ON_INSTALL`

`authentication: "NONE"` is not valid for the current Codex local
marketplace path and must fail `pnpm run release:check`.

### 8. Source-Contract Payload Validation

`pnpm run release:check` also inspects the packaged/extracted skills and docs
for the source-contract proof contract. The payload must include manual-review
evidence guidance, independent source-contract review guidance, and the
`require_independent_source_contract_review` verify gate before release.

## Runtime Constraints

Release notes and handoff instructions must preserve these v0.1
constraints:

- Node.js `>=24`
- pnpm-only dependency management
- local SQLite persistence
- Node's experimental `node:sqlite` API
- reset-not-migrate schema handling
- skill-driven runtime: each `roi:*` command shells to
  `scripts/lifecycle.mjs`. There is no MCP server, no daemon, and no
  hosted control plane.
- human-gated capability promotion

## Principle

If a release cannot prove bounded package contents, durable state,
resumability, inspectability, and clean dependency posture, it is not
yet a credible ROI release.
