# ROI Command Vocabulary

This file teaches Codex (and any other AGENTS.md-aware host) the ROI
ergonomic command surface. All commands are aliases over the live ROI MCP
server registered as the `roi` namespace. The canonical dispatch spec lives
in `skills/roi-drive/SKILL.md` and `skills/roi-go/SKILL.md`. Keep this file
in sync when commands change.

## Command Aliases → MCP Tool Sequences

| Alias | Primary MCP calls | Notes |
|---|---|---|
| `roi:go [goal]` | `status_get` → `plan_list` → (repo work) → `evidence_record` | Implementation driver — code, oracles, verification evidence |
| `roi:drive [goal]` | `status_get` → `plan_generate` → `run_create` → `verify_evaluate` → `evidence_record` | ROI lifecycle driver — runs, verify gate, publish (not repo implementation) |
| `roi:work [goal]` | `mission_create` then stop | Open/initialize a mission |
| `roi:brief` | `brief_revise` | Refine the active mission's brief |
| `roi:outline` | `plan_generate` | Generate a plan for the active mission |
| `roi:plan` | identical to `roi:outline` | Alias; same behavior |
| `roi:draft` | `run_create` | Start a new run for the active plan |
| `roi:review` | `status_get` → `review_list` → `verify_evaluate` | Evaluate current state, inspect prior reviews, and record verdict |
| `roi:publish` | `evidence_record(type=artifact)` | Record a publication marker |
| `roi:inspect` | `status_get` | Read current mission/run status |
| `roi:cancel` | `run_cancel` | Cancel the active run |
| `roi:learn` | `enlighten_run` | Detect reusable patterns in completed run |

## Lifecycle Positions

A mission moves through these positions. Use `roi:inspect` to read current
position; use `roi:drive` to advance the ROI loop; use `roi:go` to implement plans.

```
mission created
  → brief revised       (roi:brief)
  → plan generated      (roi:outline)
  → run started         (roi:draft)
  → run paused at gate  (roi:review)
  → run completed
  → mission published   (roi:publish)
```

## Two loops

| Loop | Command | What moves |
|------|---------|------------|
| Work | `roi:go` | Product repo, tests, `evidence_record` (verification) |
| ROI | `roi:drive` | Runs, `verify_evaluate`, publication artifact |

`evidence.record` accepts `run_oracles: true` (D7-w1) to MCP-run plan
`verification_targets` and set `verified_by: mcp`. Without it,
`implementation_proof_trust` stays `agent_claimed`. **`roi:drive strict`** (or
`ROI_STRICT_VERIFY=1`) chains go with `run_oracles` and verify pass with
`require_verified_proof: true` — see `skills/roi-drive/SKILL.md`. Checkpoint
`verify_evaluate(pass, allow_partial_verification: true)` — see
`skills/roi-verify/SKILL.md`. Lifecycle
completion is not external ship proof — see `docs/limitations.md`.

Recommended: `roi:outline` → `roi:go` → `roi:drive`.

## Input dispatch (`roi:go` and `roi:drive`)

Priority order:
1. **Mission ID** — if a mission ID is known in context, use it directly.
2. **Outline JSON** (`roi:go`) — artifact from `plan_generate`; confirm via `plan_list`.
3. **File path** — `.md` / `.txt` brief or requirements; extract goal, `mission_create` + `brief_revise` when needed.
4. **Goal string** — search `mission_list` for a match first.

## Agentic plan strength

Plans and briefs for **multi-turn agent execution** should optimize **outcome
strength** (invariants, property-style acceptance, falsifiable
`verification_targets`), not downstream prescription (line numbers, test scripts,
long file checklists).

**Canonical guidance:** `skills/references/agentic-plan-strength.md` — applies to
`roi:brief`, `roi:outline`, `roi:plan`, `roi:draft`, `roi:review`, and CE plan
bundle materialization (`fixtures/ce-plan-bundle.example.json`).

**Pairing:** CE plan / requirements own *what must remain true*; ROI owns *waves,
verify gate, and evidence*.

## Notes

- The ROI MCP server is `node src/server.mjs` from the ROI package root
  (registered in `~/.codex/config.toml` as `[mcp_servers.roi]`).
- Tool wire names use underscore form: `roi.mission_create`, `roi.status_get`, etc.
- Implementation dispatch: `skills/roi-go/SKILL.md`.
- Lifecycle dispatch (paused runs, verify gate, one-retry rule):
  `skills/roi-drive/SKILL.md`.
- After `roi:drive` completes, suggest `roi:learn` — do not call `enlighten_run`
  automatically.
- **Skill plugin:** `$roi-drive`, `$roi-go`, etc. appear in the Codex skill
  picker after running `scripts/install-agent-skills.sh codex`. Run it once
  per checkout; symlinks live at `~/.local/share/roi/plugins/roi/skills/`.
- **Copilot skill plugin:** same commands surface in Copilot after running
  `scripts/install-agent-skills.sh copilot`. Symlinks live at
  `~/.copilot/installed-plugins/roi-plugin/roi/skills/`.
