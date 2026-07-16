# Oracle patterns (behavior-class → minimum-fit acceptance)

**Audience:** Agents authoring or reviewing ROI `verification_targets` (in
`roi:outline`, `roi:go`, `roi:verify`) and humans reviewing plan acceptance for
**multi-turn, non-deterministic** execution.

**Core idea:** An accepted `verification_target` for a Plan's unit of implemented
behavior must carry an **oracle whose pattern fits the declared behavior class** —
the *minimum oracle pattern that can falsify that class*. Oracle **fitness** is a
refinement of falsifiability, scored on the existing **Falsifiability** row of the
emergent-strength rubric in [`agentic-plan-strength.md`](agentic-plan-strength.md),
**never** a parallel scoring ladder. Fitness is **necessary, not sufficient**: it
is checked *beneath* the reviewer's semantic-truth authority, never in place of it.
An under-fit oracle is a `verification_target` **defect** — revise before use, not
a pass.

This reference is doctrine, not machinery. It names patterns by **what they can
refute**, never by a tool or library. It adds no schema field, no scoring ladder,
and no mechanical helper block: `oracleRunner.mjs` still validates *runnability*,
and the reviewer still owns *semantic truth* (the Plan Compass output-schema
reserves semantic truth of `verification_targets[].proves` and `command_or_probe`
for the reviewer under its "Prose / operator obligations" boundary).

---

## The seven oracle patterns (by what they falsify)

| Pattern | Falsifies a claim of the form… | Cannot falsify |
| --- | --- | --- |
| **exact-match** | "output equals this exact value" (a fixed, fully-specified result) | relation-only or property claims where the exact value is not knowable |
| **property-based** | "for all inputs in a domain, this property holds" (invariants over generated inputs) | a single fixed golden value that no property captures |
| **invariant** | "this state predicate never breaks across operations" (a state/lifecycle invariant) | one-shot equivalence with no persisted state |
| **differential** | "this behaves identically to a trusted reference" (new vs. reference/oracle system) | claims with no trusted reference to diff against |
| **metamorphic** | "these input→output *relations* hold even when no direct oracle exists" | an exact value when one *is* knowable and cheaper to assert |
| **golden/snapshot** | "rendered/serialized output matches the accepted baseline" (regression/rendering) | semantic equivalence when formatting legitimately drifts |
| **smoke** | "the path executes without crashing / basic liveness" | equivalence, regression, invariant, or relation claims (liveness only) |

**Named by refutation, not by tool.** QuickCheck/Hypothesis are *property-based*
implementations; AFL is a *property/invariant* fuzz driver; a golden-file
framework implements *golden/snapshot*. The pattern is the doctrine; the tool is
external.

---

## Behavior-class → minimum-fit map

The **minimum fit** is the weakest pattern that can still falsify the whole class.
A stronger adequate pattern is acceptable (see *Fitness ordering*); a below-floor
pattern is an under-fit defect.

| Behavior class | Minimum-fit oracle (adequacy floor) | Below-floor (under-fit defect) |
| --- | --- | --- |
| **exact-value** ("returns exactly V") | exact-match | smoke |
| **equivalence / refactor-preserving** ("behavior is unchanged") | differential *or* golden/snapshot | smoke, exact-match on a partial slice |
| **regression / rendering** ("output matches accepted baseline") | golden/snapshot *or* differential | smoke |
| **pure-function / algebraic** ("∀ inputs, property holds") | property-based | exact-match on one input, smoke |
| **state / invariant** ("predicate never breaks across ops") | invariant *or* property-based | smoke, single exact-match |
| **relation-only** ("no direct oracle; relations hold") | metamorphic | exact-match, smoke |
| **liveness / availability** ("the path runs / stays up") | smoke | *(smoke is the floor here; nothing weaker)* |

The seven-row below-floor column is doctrine's **default** classification, not an
immutable fact — see *Fitness-vs-truth precedence → disputed floor*.

---

## Selectors

### 1. Fitness ordering (minimum-fit chooser)

"Minimum-fit" is operationalized as a **cheapest-discriminating** tier:

1. **Adequacy floor first.** Discard any pattern that cannot falsify the declared
   behavior class (a smoke oracle cannot falsify an equivalence or regression
   claim; an exact-match oracle cannot falsify a relation-only claim).
2. **Among adequate patterns, choose the cheapest that falsifies the *whole*
   class** — not one that only falsifies a sub-slice. Cheap = fewer moving parts,
   faster under helper timeouts, fewer external fixtures.
3. **Break remaining ties toward the more rerunnable / deterministic pattern** (a
   property or invariant oracle over a golden snapshot when both fit, because
   snapshots drift; a differential oracle over a bespoke harness when both fit).

The floor is the **hard rule**; steps 2–3 are **preference, not gate**. A plan
that picks an *adequate but not minimal* pattern is acceptable; a plan that picks
a *below-floor* pattern is an under-fit defect.

**Multi-class claims.** A claim spanning more than one behavior class (e.g.
"behavior is unchanged *and* an invariant never breaks") requires an oracle — or
oracle set — meeting the adequacy floor for **each** sub-claim. A single oracle
satisfies only the classes it can falsify; it is under-fit for any sub-claim
outside its reach. This is an extension of the adequacy floor to compound claims,
not a separate gate.

### 2. Fitness-vs-truth precedence

Fitness and semantic truth are two authorities with a **fixed precedence**:

- **Fit + reviewer accepts truth → pass.**
- **Fit + reviewer rejects truth → fail** (semantic-truth authority governs;
  reserved for the reviewer by output-schema.md, undisturbed here).
- **Under-fit → defect regardless of believed truth** — the oracle is revised
  before the pass is recorded, because a below-floor oracle cannot substantiate a
  belief even a correct one. This mirrors the `roi:go` rule that a malformed VT is
  revised via `plan_revise` *before* the implementation commit, not worked around
  in-turn.

There is no state in which fitness overrides a reviewer truth-rejection, and none
in which a believed truth rescues a below-floor oracle.

**Disputed floor.** The seven-row below-floor table is doctrine's default, not an
immutable fact. When an operator disputes whether a pattern is below-floor for a
given class (e.g. "smoke *is* adequate here"), the dispute is bound to the **same
reviewer authority that owns semantic truth**: the reviewer's floor call governs
the individual pass. A *persistent* dispute — one that would change the default
table for all future plans — is a **promotion-gate** question (it edits doctrine),
routed to the delivery-posture promotion contract (`governance.md`'s
`bootstrap_advisory → candidate_authority → promoted_default` lifecycle in the
delivery-posture meta-design set), never resolved silently per-plan.

### 3. Unlisted-class fallback

When a unit's behavior fits **none** of the seven classes cleanly, the map fails
**safe**, not closed-with-no-escape:

- **Default to the weakest-assumption pattern that still has a floor:**
  metamorphic-relation (assert relations when no direct oracle exists), then
  differential (compare against a trusted reference), in that order of preference.
- **If neither is constructible, the unit is deferred on an explicitly recorded
  "no-fit" note** with its candidate probe named. It is **never** passed on a
  smoke/liveness oracle as a substitute. Deferral keeps blocking acceptance of
  that unit; it does not silently downgrade to the weakest available oracle.

### 4. Handoff threshold

A verify handoff for a unit must **preserve**: unit identity, the **declared
behavior class**, the **chosen oracle pattern**, and the `verification_target`'s
`command_or_probe` + `proves`. The behavior class must be **nameable from
`proves`** — no new schema field is introduced; `proves` carries it. A handoff
that drops the behavior-class declaration or the chosen pattern is **invalid** and
is treated as an under-fit defect at verify — the reviewer cannot judge fitness
against an undeclared class.

### 5. Approval / promotion boundary

This doctrine and any future fitness self-check **own oracle selection only** —
they must not own plan approval, scope adjudication, completion, or the reviewer's
semantic-truth authority. A fitness *mandate* moved to repo `promoted_default`
(e.g. "rendering-behavior claims MUST use a golden or differential oracle") runs
the existing promotion contract + rollback in the delivery-posture governance
doctrine (`governance.md`); no oracle-type mandate becomes repo-authoritative on a
single result. This doctrine ships **bootstrap_advisory**.

---

## Anti-goals

- A separate oracle-fitness scoring ladder competing with the Falsifiability
  rubric row.
- Fitness pushed into `oracleRunner.mjs` as a mechanical block (it validates
  runnability, not fit).
- The doctrine auto-deciding semantic truth (reserved for the reviewer).
- A below-floor oracle (smoke for equivalence/regression, exact-match for
  relation-only) recorded as a pass.
- An unlisted-class unit silently downgraded to the weakest available oracle
  instead of deferred.
- Patterns named by tool/library rather than by what they falsify.
- Coupling plan acceptance to the adversarial review harness
  (`scripts/adversarial/run_oracle.sh`); the review typology is a sibling
  reference, not shared authority.
- A fitness mandate promoted to default on a single result, bypassing the
  seven-class gate.

---

## Validation fixtures (behavioral, not rhetorical)

These are the acceptance fixtures for this doctrine. Each is resolved by
**inspection against the map and selectors above**, not by a code checker (fitness
is reviewer-judged, per the Anti-goals).

1. **Under-fit floor:** a refactor-equivalence claim carrying only a smoke oracle
   is flagged **under-fit** (below-floor), not passed.
2. **Ordering preference:** a state-change claim admitting both invariant and
   golden patterns selects the **invariant** oracle (cheaper + more rerunnable)
   under the tie-break — and a plan that picked the golden oracle is **accepted**
   (adequate, not minimal), proving steps 2–3 are preference, not gate.
3. **Truth precedence:** a fit oracle whose `proves` the reviewer rejects **fails**
   acceptance; an under-fit oracle **blocks** regardless of a believed-true claim.
4. **Unlisted-class defer:** a behavior fitting none of the seven classes with no
   constructible metamorphic/differential oracle is **deferred** with a recorded
   no-fit note and keeps blocking the unit — never downgraded to smoke.
5. **Handoff:** a verify handoff missing the behavior-class declaration is treated
   as an **under-fit defect**.
6. **Multi-class:** a claim spanning equivalence + invariant with a single oracle
   covering only equivalence is flagged **under-fit for the invariant sub-claim**.
7. **Host-neutrality / sibling boundary:** plan acceptance passes with the
   adversarial review harness **absent**; `python3 scripts/verify.py` and
   `make check-authority` pass with no testing-tool dependency added.

---

## Relationship to the emergent-strength rubric

Oracle fitness is scored on the **Falsifiability** row of the emergent-strength
rubric in [`agentic-plan-strength.md`](agentic-plan-strength.md). The row's `2`
cell — "Properties + commands **with a class-fit oracle**" — is the top score;
an oracle that is falsifiable but under-fit for its class scores below `2`. This
is deliberately **not** a ninth rubric row: an under-fit oracle is weakly
falsifiable, so fitness belongs inside the falsifiability score, not beside it.

---

## Maintenance

Canonical copy in this package: `skills/references/oracle-patterns.md`
(this file).

Installed with `scripts/install-agent-skills.sh` to Claude/Codex/Copilot plugin
paths, alongside [`agentic-plan-strength.md`](agentic-plan-strength.md). If
another workspace mirrors this guidance, update the mirror when this file
changes.
