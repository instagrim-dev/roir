# Changelog

## 0.1.0

ROI v0.1 ships as a **skill-driven, local-first** package. Each `roi:*`
command opens a `SKILL.md` under `skills/` and shells to
`node scripts/lifecycle.mjs <verb>` to persist state in local SQLite. There
is **no MCP server, daemon, or long-running process**.

### Runtime

- skill-driven command surface (`roi:start` / `roi:work` through
  `roi:inspect`), with `roi:go` (implement) and `roi:drive` (lifecycle
  driver) as the primary entry points
- lifecycle helper at `scripts/lifecycle.mjs` as the single persistence
  path; `node scripts/lifecycle.mjs --list-verbs` is the canonical verb
  registry (52 snake_case verbs, e.g. `mission_create`, `plan_generate`,
  `evidence_record`, `verify_evaluate`)
- local SQLite system of record; `ROI_SQLITE_PATH` selects the file
  (default `.data/roi.sqlite` under `roi/`), with WAL handling concurrent
  helper invocations
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
- `pnpm run release:check` — release gate
- `pnpm run sync:lifecycle-verbs` — keeps `fixtures/lifecycle-verbs.json`
  in sync with the helper's verb registry
- `pnpm run materialize:ce` — materializes a CE plan bundle into ROI
  artifacts

### Docs & packaging

- quickstart, installation, multi-runtime (Codex Tier 1, Claude Code,
  Cursor, Copilot CLI, generic MCP host), architecture, state-and-artifacts,
  command-reference, limitations, troubleshooting, and FAQ docs
- OSS hygiene: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`
- private local-first distribution via a `roi-plugin-*.tgz` handoff tarball
  (no remote registry); see [`docs/release-validation.md`](docs/release-validation.md)
- user-facing terminology aligned on `enlighten` / `enlightenment` for the
  compounding pass (`roi:enlighten` → `roi:learn`)
