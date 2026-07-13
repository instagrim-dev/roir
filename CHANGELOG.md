# Changelog

## 0.1.2

- add an immutable mission snapshot exporter
  (`scripts/export-immutable-snapshot.mjs`, `pnpm run export:immutable`,
  `src/immutableExport.mjs`) that captures a single mission's complete,
  digest-verifiable state from a read-only source snapshot without writing
  lock sidecars, failing closed on concurrent writes, live WAL/SHM sidecars,
  or an unsupported schema version. The manifest covers every mission-scoped
  table (including research records and context packs) with collision-free
  per-record ids across brief/plan/capability revisions.

## 0.1.1

Public-release cleanup after the history scrub.

- remove private scratch review/dogfood artifacts from the published history
  and release tarball surface
- align release-facing docs on public-source, local-first tarball
  distribution while preserving the no-registry publishing constraint
- keep the extracted-package release gate as the release bar

## 0.1.0

Initial ROI release as a **skill-driven, local-first** package.

Each `roi:*` command opens a `SKILL.md` under `skills/` and shells to
`node scripts/lifecycle.mjs <verb>` to persist durable state in local
SQLite. There is **no MCP server, daemon, or long-running process** in
the shipped runtime.

### Highlights

- ship the full ROI command surface from `roi:start` / `roi:work`
  through `roi:inspect`, with `roi:go` (implementation) and `roi:drive`
  (lifecycle orchestration) as the primary operator entry points
- pin the lifecycle helper (`scripts/lifecycle.mjs`) as the single
  persistence path and expose its 52-verb snake_case registry as the
  canonical wire contract
- support release tarball handoff with package-root-safe proof handling,
  bundled Cursor vocabulary rules, and extracted-package release smoke in
  `pnpm run release:check`
- document and ship host integration for Codex, Claude Code, Cursor, and
  GitHub Copilot CLI without requiring a dedicated ROI backend process

### Runtime

- skill-driven command surface (`roi:start` / `roi:work` through
  `roi:inspect`), with `roi:go` (implement) and `roi:drive` (lifecycle
  driver) as the primary entry points
- lifecycle helper at `scripts/lifecycle.mjs` as the single persistence
  path; `node scripts/lifecycle.mjs --list-verbs` is the canonical verb
  registry (52 snake_case verbs, e.g. `mission_create`, `plan_generate`,
  `evidence_record`, `verify_evaluate`)
- local SQLite system of record; `ROI_SQLITE_PATH` selects the file
  (default `.data/roi.sqlite` under the active ROI package root), with
  WAL handling concurrent helper invocations
- review-gated workflow template (`implement` → `spec_review` →
  `quality_review` → `verify_gate`); `roi:drive` pauses at the verify and
  publish gates for operator-owned judgments
- bounded A2A-aware execution path for remote work (`@a2a-js/sdk`)
- human-gated capability promotion via `roi:learn` / `roi:enlighten`

### Removed since earlier prototypes

- **stdio MCP server (removed).** Earlier ROI prototypes bundled a stdio
  MCP server (`src/server.mjs`) and an MCP tool manifest
  (`fixtures/mcp-tools.json`) with `sync:mcp-tools` / `smoke` scripts. The
  v0.1 runtime is the lifecycle helper invoked per-command by each skill;
  hosts compose ROI by registering skills, not by speaking MCP to a
  long-running ROI process. MCP remains available only as an optional
  *host* integration surface (see [`docs/multi-runtime.md`](docs/multi-runtime.md)).

### Tooling & validation

- `pnpm test` — `node --test` suite
- `pnpm run smoke:integration` — end-to-end lifecycle + SQLite subprocess
  smoke (`scripts/integration-smoke.mjs`)
- `pnpm run release:check` — release gate, including extracted-package
  install + smoke verification
- `pnpm run sync:lifecycle-verbs` — keeps `fixtures/lifecycle-verbs.json`
  in sync with the helper's verb registry
- `pnpm run materialize:ce` — materializes a CE plan bundle into ROI
  artifacts

### Docs & packaging

- quickstart, installation, multi-runtime (Codex Tier 1, Claude Code,
  Cursor, Copilot CLI), architecture, state-and-artifacts,
  command-reference, limitations, troubleshooting, and FAQ docs
- CE migration guides for Codex, Claude Code, and Copilot CLI
- OSS hygiene: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`
- public-source, local-first distribution via a `roi-plugin-*.tgz` handoff
  tarball (no remote registry); see
  [`docs/release-validation.md`](docs/release-validation.md)
- user-facing terminology aligned on `enlighten` / `enlightenment` for the
  compounding pass (`roi:enlighten` → `roi:learn`)
