# Agentic plan strength (ROI + CE handoff)

**Audience:** Agents running `roi:outline`, `roi:brief`, `roi:draft`, `ce-plan`,
and humans reviewing plans for **multi-turn, non-deterministic** execution.

**Core idea:** Strength is **outcome leverage under replay**, not verbosity or
downstream prescription. Literal file paths, line numbers, and mechanical test
scripts are **advisory accelerators** when the codebase is stable — not the
definition of rigor.

---

## Two notions of “strong”

| Notion | Optimizes for | Risk |
| --- | --- | --- |
| **Instruction strength** | Less ambiguity per turn | Brittle after rebase; agents spend turns reconciling stale anchors |
| **Outcome strength** | Correct product state with bounded freedom | Feels vague unless backed by falsifiable oracles |

For agentic execution, prefer **outcome strength**. Pair with ROI **verify gates**
and CE **scope walls**, not micro-step choreography.

---

## Binding altitude

For each plan field, ask: **if the agent ignores this, is the iteration still valid?**

| High altitude (load-bearing) | Low altitude (usually advisory) |
| --- | --- |
| Invariants (“never log tokens”, distinct event namespaces) | Line numbers |
| Falsifiable oracles (property + optional `go test -run` filter) | Exact symbol names before opening files |
| Scope topology (in / out / deferred; sibling feature ids) | Long file laundry lists |
| Pattern contracts (“mirror compatEmitter lifecycle”) | RED/GREEN step scripts |
| Non-goals that block scope creep | Per-chunk log prescriptions |
| One composition closure definition | Full route-matrix coverage in one PR |

**Rule:** Plans should be mostly high altitude + a few **low-altitude oracles**
only where ambiguity caused real regressions before.

---

## Property-style acceptance (preferred)

Write acceptance as **observable properties**, not test implementations.

| Weak (script) | Strong (property) |
| --- | --- |
| “Add `TestFoo` at line 120” | “Missing bearer → 401 and exactly one structured `auth_rejected` with no token attribute” |
| “Edit `server.go` Shutdown” | “Active SSE client: `Shutdown` completes within `shutdownTimeout` without hung goroutines” |
| “Implement hub hardening” | “Single smoke: health → session → SSE with OpenAI-compat **disabled**” |

ROI `verification_targets` should be **oracles** (commands or grep gates), not
test bodies. CE plan units may add one **advisory** file hint per unit.

---

## Emergent-strength rubric (0–2 per row)

Score the artifact; **do not** treat high sums as “more lines.”

| Criterion | 0 | 1 | 2 |
| --- | --- | --- | --- |
| **Falsifiability** | No checkable done | Commands only | Properties + commands |
| **Scope enforcement** | Vague goals | Non-goals listed | Non-goals + cross-feature ids (#61 out) |
| **Invariant clarity** | Unstated | Implied | Explicit |
| **Discovery budget** | Everything prescribed | Mixed | Open implementation, closed oracles |
| **Replay value** | Line anchors | Mostly stable | Stable across rebase |
| **Orchestration fit** | Markdown only | CE or ROI alone | CE constraints + ROI waves/gates |
| **Execution topology** | Agent counts in plan | Waves only | Waves + mutual exclusion where overlap risky |
| **Abstraction restraint** | New helper / type / package introduced without naming the existing seam considered | New layer named, but justified only by aesthetic invariants ("clean boundaries") | New layer named existing seam considered, rejection reason grounded in seam behavior, falsifiable architectural invariant the layer enforces — *or* no new abstraction at all |

**Emergent strength** ≈ high falsifiability + invariants + scope, without
requiring mechanical prescription.

---

## ROI-specific guidance

### `roi:brief`

- **Load-bearing:** `problem`, `constraints`, `success_criteria`, `non_goals`
- **Avoid:** implementation file lists in the brief

### `roi:outline` / `plan_generate`

- **Plans:** outcome-oriented `scope` citing REQ ids or invariants
- **actions:** verbs + property (“emit auth_rejected from requireAuth”), not file edits
- **verification_targets:** runnable gates (`go test -run …`, doc grep, build)
- **dependencies:** prefer **plan UUIDs** after first `plan_list`; string labels
  are acceptable only when paired with CE `bundle_id` / unit ids
- **Do not merge** unrelated atomic units to reduce plan count unless the user
  explicitly wants one run — merged plans weaken discovery budget
- When a CE plan or requirements doc exists, **import constraints and oracles**
  from it; do not re-invent scope

### `roi:draft` / `roi:review`

- Evidence should cite **oracle passage**, not “followed step 3”
- **Pass** when properties hold, not when every advisory path was touched

### CE plan bundle (`ce_plan_bundle`)

The checked-in fixture `fixtures/ce-plan-bundle.example.json` shows the current
bundle shape:

| Field | Altitude |
| --- | --- |
| `verification` | **High** — copy property bullets |
| `execution_note` | **High** — axis / REQ closure |
| `patterns_to_follow` | **Medium** — pattern refs, not line numbers |
| `files` | **Low** — optional hints, ≤ few paths per unit |
| `depends_on` | **High** — unit ids |

---

## CE-plan-specific guidance (handoff target)

When `ce-plan` consumes ROI or maturity requirements:

- **Keep:** REQ traceability, key decisions, composition definition, risks, scope
- **Per unit:** ≥1 property-style acceptance; ≤1 advisory file hint
- **Avoid:** line numbers; exhaustive test scripts; mandatory AE links on every scenario
- **Defer** exact helper names and harness shape to implementation discovery

Maturity requirements (`REQ-MAT-*`) should already separate **Behavior** and
**Acceptance criteria** in property form; `Primary files` is advisory.

---

## Pairing CE-plan and ROI (recommended)

| Layer | Owns |
| --- | --- |
| CE plan / requirements | What must remain true (constraints, oracles, non-goals) |
| ROI mission / plans | When to stop, waves, verify gate, durable evidence |
| Neither | How every line is written; agent/team headcount |

---

## Convergent workflows (ratchet / optimize)

Some workflows optimize a **scalar** on a fixed oracle (latency, `ns/op`, frame gap).
They are **more convergent** than maturity iterations but still agent-safe when the
skill separates **deterministic measure/decide** from **stochastic search**.

| Layer | Owns |
| --- | --- |
| Skill envelope | Target registry, ε, guards, stop, anti-gaming, experiment card shape |
| Deterministic steps | `go test`, `benchstat`, corpus budget compare |
| Agent | Hypothesis + minimal diff per iteration |

**BMO Cursor/Codex skill:** `$bmo-ratchet-loop` (first profile: TUI — hotpath /
unhappy / dynamic). See `.cursor/skills/bmo-ratchet-loop/` and
`~/.codex/skills/bmo-ratchet-loop/`.

Do **not** write a full ce-plan per iteration. Optional: 1-page charter + ROI
mission with `verification_targets` only at promote gate.

---

## Execution topology (multi-agent, teams, parallelism)

**Default:** Shape execution strategy **during implementation**, not in the plan.
Team layout, subagent types, and parallel tool use are **harness configuration** —
they churn with context window, model, and host capabilities.

**Prescribe in the plan only when ignoring it could yield a valid-looking pass
that violates product intent** — expressed as **constraints and waves**, not
headcount.

### Plan-time (load-bearing)

| Prescribe as… | Example | Not this |
| --- | --- | --- |
| **Unit dependency** | U3 depends on U1 (emitter before auth wiring) | “Agent A then Agent B” |
| **Wave / parallelism** | U2 ∥ U7 after U1; U4–U6 sequential (shared getter contract) | “Run 3 subagents in parallel” |
| **Mutual exclusion** | One implementer for `auth.go` + shutdown path in same PR slice | “Don’t split server.go across agents” |
| **Gate / role separation** | Review pass before merge; human scorecard rescore PR separate | “Spawn adversarial-reviewer subagent” |
| **Oracle that implies singularity** | One hub composition test as Pattern-4 closure | “One agent owns composition smoke” |
| **Flake-sensitive lane** | Shutdown+SSE: `-race` required on new tests | “Dedicated race-hunt agent” |

CE plans: use **U-ID dependencies** and optional “may run in parallel with” notes.
ROI: use **`wave`** and **plan UUID `dependencies`** after `plan_list`.

### Implementation-time (shape here)

| Decision | Basis |
| --- | --- |
| Parallel units | No overlapping **write** set; independent oracles |
| Subagents / Task tool | Different **oracles** per role (implement vs review vs verify), not duplicate exploration |
| Single vs multi session | File overlap, merge risk, operator preference |
| `ce-work` vs `roi:draft` | ROI when verify gate + evidence matter; CE when plan is the contract |

### When multi-agent helps

- **Role separation with different success criteria:** implementer (land properties),
  reviewer (scope + invariants, read-only), verifier (run `verification_targets` only).
- **Read-heavy prep in parallel** with **one writer** for the hot seam (optional;
  not required in plan unless discovery is the iteration goal).

### When multi-agent hurts

- Two agents exploring the same package with no split boundary.
- Parallel **writes** on the same files (emitter + shutdown in different agents).
- Planner and implementer both rewriting the plan mid-flight.
- Prescribed parallelism for speed without independent oracles.

### Layer placement

| Layer | Execution strategy |
| --- | --- |
| Requirements | Rarely — only composition/singularity oracles (“single hub smoke”) |
| CE plan | Dependencies, optional parallel-safe note, review gates |
| ROI outline | `wave`, plan deps, `workflow_template` (implement → review → verify_gate) |
| Implementation | Subagents, parallel reads, session split |

### Quick rule

> **Plan waves and exclusions; implementers choose teams.**

Add one plan sentence only when needed:

- “U4–U6 share `HTTPServerStatusSnapshot` — land U4 before U5/U6 (same PR or sequential commits).”
- “Do not parallelize edits to `server.go` Start/Shutdown and `auth.go` requireAuth.”

---

## Abstraction restraint

A frequent failure mode in model-generated plans is the **speculative new
abstraction layer**: a helper, type, package, indirection, framework,
coordinator, manager, registry, or "clean boundary" the codebase did not
previously contain. Models are persuasive about new structure — "introduce
a `pkg/foo` coordinator to centralize X" reads as competent design — but
once the layer exists, removing it costs roughly an order of magnitude
more than refusing it would have. Prefer existing seams; force evidence
before adding new ones.

**Plan-time bar (scored on the rubric row above):**

A plan that introduces a new abstraction must answer three questions in
the brief or plan scope:

1. **Which existing seam was considered first?** Name the package, type,
   or function the responsibility could plausibly attach to.
2. **Why can't that seam carry the work?** One sentence per rejection
   reason, grounded in what the seam does today (read the file, not the
   model's prior of what the file does).
3. **What falsifiable architectural invariant does the new layer
   enforce?** Aesthetic invariants ("clean boundaries", "better
   separation") are not falsifiable. "No package outside
   `internal/agent/**` may import `internal/agent/internal/`" is.

If the brief proposes new structure without these three answers, the
abstraction is **speculative** and should be either demoted to an
`assumption` (so a verification target can falsify it during `roi:go`) or
removed from scope until evidence forces it. `roi:outline` applies this as
a procedural `plan_generate` stop condition the agent must self-enforce —
the helper does not mechanically reject a plan that encodes a speculative
abstraction — see the `roi-outline` SKILL.md procedure step 4.

**Why doctrine names this:** the `actions` and `scope` rubric rows alone
don't catch a smuggled abstraction, because a new layer can be described
in property-style language and pass falsifiability tests scoped to itself.
The `Abstraction restraint` row scores whether the *premise* — that a new
layer is needed — was justified, not whether the new layer's behavior is
testable.

---

## Anti-patterns

- **False precision:** “~line 575” — stale after one edit
- **Checklist plans:** 20 files with no property — agents tick boxes without proof
- **Vague ROI plans:** “implement hardening” with no `verification_targets`
- **Namespace collision:** duplicating per-request middleware events in lifecycle taxonomy
- **Merged waves for convenience:** U4/U5/U6 as one plan when rescore needs atomic landings
- **Agent theater:** “spawn 4 explore agents” with no role-specific oracle
- **Parallelism without exclusion:** two implementers on overlapping write paths
- **Speculative new abstraction:** introducing `pkg/foo` / a coordinator / a manager / a "clean boundary" the codebase didn't previously need, justified by aesthetic invariants ("better separation", "cleaner") rather than a named existing seam considered first and a falsifiable architectural invariant. See the *Abstraction restraint* section above.

---

## Maintenance

Canonical copy in this package: `skills/references/agentic-plan-strength.md`
(this file).

Installed with `scripts/install-agent-skills.sh` to Claude/Codex/Copilot plugin
paths. If another workspace mirrors this guidance, update the mirror when this
file changes.
