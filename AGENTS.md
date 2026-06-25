# ROI Command Vocabulary

ROI is a **skill-driven** lifecycle. There is no MCP server, no tool
registry to query, no daemon to keep alive. Each `roi:*` command opens a
SKILL.md under `skills/` and follows its procedure. Skills shell to
`node scripts/lifecycle.mjs <verb>` to persist state in SQLite
(`.data/roi.sqlite` by default).

This file teaches Codex (and any other AGENTS.md-aware host) the ROI
ergonomic command surface and the underlying helper contract. Canonical
dispatch lives in `skills/roi-drive/SKILL.md` and `skills/roi-go/SKILL.md`.
Keep this file in sync when commands change.

## Command Aliases → Skills

| Alias | Stage | Canonical skill |
|---|---|---|
| `roi:start [goal]` | Open / initialize a mission | `skills/roi-start/SKILL.md` |
| `roi:work [goal]` | Alias for `roi:start` | `skills/roi-work/SKILL.md` |
| `roi:clarify` | Refine brief | `skills/roi-clarify/SKILL.md` |
| `roi:brief` | Alias for `roi:clarify` | `skills/roi-brief/SKILL.md` |
| `roi:source` | Record research findings | `skills/roi-source/SKILL.md` |
| `roi:research` | Alias for `roi:source` | `skills/roi-research/SKILL.md` |
| `roi:outline` | Generate plans | `skills/roi-outline/SKILL.md` |
| `roi:plan` | Alias for `roi:outline` | `skills/roi-plan/SKILL.md` |
| `roi:go [goal]` | Implement plans in product repo | `skills/roi-go/SKILL.md` |
| `roi:draft` | Open a run | `skills/roi-draft/SKILL.md` |
| `roi:run` | Run lifecycle (create / resume) | `skills/roi-run/SKILL.md` |
| `roi:drive [goal]` | Thin lifecycle orchestrator | `skills/roi-drive/SKILL.md` |
| `roi:verify` | Record verdict at verify_gate | `skills/roi-verify/SKILL.md` |
| `roi:review` | Alias for `roi:verify` | `skills/roi-review/SKILL.md` |
| `roi:edit` | Respond to non-pass verdict | `skills/roi-edit/SKILL.md` |
| `roi:publish` | Record publication / handoff marker | `skills/roi-publish/SKILL.md` |
| `roi:learn` | Pattern detection / capability proposal | `skills/roi-learn/SKILL.md` |
| `roi:enlighten` | Alias for `roi:learn` | `skills/roi-enlighten/SKILL.md` |
| `roi:inspect` | Read mission state | `skills/roi-inspect/SKILL.md` |
| `roi:status` | Alias for `roi:inspect` | `skills/roi-status/SKILL.md` |
| `roi:cancel` | Cancel a run | `skills/roi-cancel/SKILL.md` |

## How a skill runs

Every skill closes with a standard **Reporting** block:

```
mission_id: <id>
<stage-specific fields>
next_actions: <quoted from helper output>
→ <one sentence interpreting that next step>
```

Skills do not invent next actions. They quote `next_actions` from the
helper response verbatim and add one bridge sentence. If `next_actions`
is empty, the skill says so and stops.

## Lifecycle Positions

```
mission created
  → brief revised        (roi:clarify)
  → research recorded    (roi:source — optional)
  → plans generated      (roi:outline)
  → implementation done  (roi:go)
  → run created          (roi:draft / roi:run)
  → paused at verify_gate (roi:verify — operator-owned)
  → paused at publish_gate (roi:publish — operator-owned)
  → terminal             (optional roi:learn)
```

`roi:drive` advances through non-gate stages and **stops at the verify
and publish gates**. The operator runs `roi:verify` and `roi:publish`
explicitly because both stages produce durable judgments.

A full `roi:verify` pass reconciles the run ledger after `roi:go` evidence is
substantive for every run plan: queued run-scope workflow tasks are completed,
the run becomes `completed`, superseded stale blockers are hidden from
`status_get.blocking_issues`, and `next_actions` moves to `roi:publish` plus
`roi:learn`. Partial checkpoint passes deliberately do not publish.

## Two loops

| Loop | Command | What moves |
|------|---------|------------|
| Work | `roi:go` | Product repo, tests, `evidence_record` (verification) |
| ROI | `roi:drive` | Status read → delegate to next stage skill; pauses at gates |

`roi:drive` is a **thin orchestrator**. It does not edit code, record
evidence, or record verdicts. Those belong to the named stage skills.

`evidence_record` accepts `run_oracles: true` to have the helper run plan
`verification_targets` directly and stamp `verified_by: mcp` (legacy stamp
name; means **helper-verified**). Without it,
`implementation_proof_trust` stays `agent_claimed`. **Strict** mode
(operator says "strict" or `ROI_STRICT_VERIFY=1`) chains `roi:go` with
`run_oracles: true` and `roi:verify` with `require_verified_proof: true`.

Recommended pairing: `roi:outline` → `roi:go` → `roi:drive` (or just
`roi:drive`, which will invoke `roi:go` when implementation is owed).

## Lifecycle helper contract

```bash
node scripts/lifecycle.mjs <verb> '<json-args>'
node scripts/lifecycle.mjs <verb> -          # JSON via stdin (long bodies)
node scripts/lifecycle.mjs --list-verbs      # canonical verb registry
```

Output is pretty-printed JSON of the service method's return value on
stdout. Exit 0 on success, exit 1 with a `lifecycle: <verb> failed: …`
message on stderr otherwise.

Verbs are snake_case (`mission_create`, `plan_generate`,
`evidence_record`). The helper's `--list-verbs` output is the canonical
surface — do not memorize the list.

Storage: `.data/roi.sqlite` by default; override with `ROI_SQLITE_PATH`.
SQLite WAL handles concurrent invocations safely.

## Inline Plan Intake

ROI natively accepts inline Plan output from Codex, Copilot, Claude Code,
Cursor, CE, and plain Markdown. Stage skills normalize that text before
execution instead of making the operator copy steps into ROI fields by hand.

Use the non-persistent helper first:

```bash
node scripts/lifecycle.mjs plan_normalize '{"stage":"outline","text":"<inline plan text>"}'
```

`plan_normalize` returns `normalized.plans` in `plan_generate` shape plus a
`brief_patch`. The invoked stage decides the durable write:

- `roi:clarify` / `roi:brief` records scope, constraints, assumptions, and
  success criteria through `brief_revise`.
- `roi:outline` / `roi:plan` passes `normalized.plans` to `plan_generate`
  after applying normal plan-quality checks.
- `roi:go` / `roi:drive` must first ensure normalized plans are persisted
  with `plan_generate`; implementation still runs only from stored ROI
  plans and records `roi:go` evidence per plan.

Normalization preserves intent and removes host-specific UI/prose wrappers;
it does not make external Plan text authoritative over ROI gates, helper
`next_actions`, verification policy, or plan-quality rules.
If no explicit validation lines are detected, normalized plans carry empty
`verification_targets` plus `requires_verification_targets: true`; `roi:outline`
must add runnable targets before persistence.

## Input dispatch (`roi:go` and `roi:drive`)

Priority order:

1. **Mission ID** — if a mission ID is known in context, use it directly.
2. **Outline JSON** (`roi:go`) — artifact from `plan_generate`; confirm
   via `plan_list`.
3. **Inline Plan text** — run `plan_normalize` with the invoked stage,
   then persist via the stage-owned helper verb before continuing.
4. **File path** — `.md` / `.txt` brief or requirements; extract goal,
   `mission_create` + `brief_revise` when needed.
5. **Goal string** — search `mission_list` for a match first.

## Agentic plan strength

Plans and briefs for **multi-turn agent execution** should optimize
**outcome strength** (invariants, property-style acceptance, falsifiable
`verification_targets`), not downstream prescription (line numbers, test
scripts, long file checklists).

**Canonical guidance:** `skills/references/agentic-plan-strength.md` —
applies to `roi:clarify`, `roi:outline`, `roi:plan`, `roi:draft`,
`roi:verify`, and CE plan bundle materialization
(`fixtures/ce-plan-bundle.example.json`).

**Pairing:** CE plan / requirements own *what must remain true*; ROI owns
*waves, verify gate, and evidence*.

## Notes

- The lifecycle helper is the only persistence path. There is no MCP
  server.
- Verb names use underscore form: `mission_create`, `status_get`,
  `evidence_record`, etc.
- Implementation dispatch: `skills/roi-go/SKILL.md`.
- Lifecycle dispatch (status read → delegate; mandatory gates):
  `skills/roi-drive/SKILL.md`.
- After `roi:drive` reaches terminal state, suggest `roi:learn` — do not
  call `enlighten_run` automatically.
- **Trust honesty:** lifecycle completion is not external-ship proof.
  Cite git/CI/human review outside ROI when reporting product readiness.
  See `docs/limitations.md`.
