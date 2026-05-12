# ROI Example Workflows For Software Engineers

These workflows show how a software engineer might use ROI's command surface
to drive real delivery work from mission intake through learning.

Start with the primary docs first:

- [`../docs/quickstart.md`](../docs/quickstart.md)
- [`../docs/command-reference.md`](../docs/command-reference.md)
- [`../docs/architecture.md`](../docs/architecture.md)

Use this page as a scenario catalog once the core lifecycle is familiar.

## 1. Bug Fix With Review Reopen

Use this when you have a concrete defect and want a durable record of the fix,
the validation evidence, and the follow-up learning.

### Example flow

1. `roi:work`
   Create a mission for the bug and seed the initial brief.
2. `roi:brief`
   Record reproduction steps, constraints, affected systems, and success
   criteria.
3. `roi:outline`
   Break the work into reproduction, diagnosis, fix, and regression coverage.
4. `roi:draft`
   Execute the fix locally.
5. `roi:review`
   If review fails, the run reopens and tasks pause instead of being silently
   overwritten.
6. `roi:edit`
   Revise the outline or launch the next draft.
7. `roi:draft`
   Resume the paused work and land the remediation.
8. `roi:review`
   Record passing evidence.
9. `roi:publish`
   Mark the handoff boundary for the fix.
10. `roi:learn`
   Propose a reusable bugfix pattern or verification recipe if the same class
   of defect keeps recurring.

Expected end state:
- run is completed
- passing evidence is stored
- `roi:learn` may return either a proposal or `noop`

Stored artifacts to expect:
- brief revision
- plan revision
- completed run
- verification evidence
- optional proposed capability

### Sample mission shape

```json
{
  "title": "Fix OAuth callback regression",
  "goal": "Restore successful login after the OAuth callback route change.",
  "success_criteria": [
    "Users can complete login again.",
    "Regression coverage exists for the callback path."
  ]
}
```

## 2. New Feature Delivery

Use this when the work needs shaping, execution, and a durable trail from
product intent to validated output.

### Example flow

1. `roi:work`
   Define the feature mission.
2. `roi:brief`
   Capture constraints, explicit non-goals, rollout boundaries, and user
   success criteria.
3. `roi:source`
   Record design references, API constraints, or external docs.
4. `roi:outline`
   Produce atomic plans and assign waves.
5. `roi:draft`
   Execute wave one.
6. `roi:inspect`
   Inspect tasks, traces, policy decisions, and blocking states.
7. `roi:draft`
   Continue later waves.
8. `roi:review`
   Compare evidence to the brief and outline targets.
9. `roi:publish`
   Mark the feature as ready to hand off.
10. `roi:learn`
   Promote a reusable workflow if the feature type is likely to repeat.

Expected end state:
- one or more completed runs with passing verification
- status view shows plans, routing decisions, and review records

When to consult `roi:inspect`:
- after each wave
- before resuming a paused run
- before deciding whether learning is likely to produce a proposal

### Good fit

- CRUD feature implementation
- API endpoint plus client integration
- Admin tools and internal platform work

## 3. Risky Change With Policy Preflight

Use this when execution might cross a safety boundary and you want explicit
policy evaluation before the run proceeds.

### Example flow

1. `roi:work`
   Create a mission for the risky change.
2. `roi:brief`
   Capture the blast radius and rollback assumptions.
3. `roi:outline`
   Separate inspection, dry-run, execution, and validation phases.
4. `roi:draft`
   Attempt the work.
5. `roi:inspect`
   If the run is blocked, inspect the stored `PolicyDecision` and the blocked
   task state.
6. `roi:brief`
   Revise the brief or narrow the requested action.
7. `roi:edit`
   Update the outline or execution plan for the narrowed scope.
8. `roi:draft`
   Re-run the now-bounded work.

Expected end state:
- either the work advances with a narrowed scope or remains explicitly blocked

When to consult `roi:inspect`:
- immediately after the block
- after revising the brief

### Good fit

- filesystem-destructive operations
- schema changes
- production-adjacent cleanup
- automation that needs human gating

## 4. Remote Specialist Delegation Over A2A

Use this when local orchestration should hand off one bounded task to a remote
agent without turning A2A into a second source of truth.

### Example flow

1. `roi:work`
   Define the mission locally.
2. `roi:outline`
   Identify the subtask that should run remotely.
3. `roi:draft`
   Set `mode` to `a2a` and provide `a2a_agent_card_url`.
4. `roi:inspect`
   If the task is still running remotely, ROI keeps the local task in
   `waiting_on_external`.
5. `roi:draft`
   Resume the run later. ROI reconciles the remote task state into the local
   `Run`, `Task`, `Trace`, and `Evidence` objects.
6. `roi:review`
   Validate the delivered remote result against the local brief and plan.

Expected end state:
- local ROI state remains authoritative
- remote work is reconciled into local run, task, trace, and evidence records

When to consult `roi:inspect`:
- while work is in `waiting_on_external`
- before deciding whether to resume or troubleshoot the remote side

### Why this matters

ROI keeps local SQLite state authoritative even when the work executes through
another agent.

## 5. Repeated Work To Reusable Capability

Use this when the same delivery pattern keeps showing up and you want the
system to turn it into leverage.

### Example flow

1. Complete similar missions multiple times with `roi:work` through
   `roi:publish`.
2. Run `roi:learn`.
3. Inspect the detected pattern and the proposed capability.
4. Review whether the promotion target should become:
   a workflow,
   a verification recipe,
   a context pack template,
   or a specialist overlay.
5. Promote the capability only after human review.

Expected end state:
- either a proposed capability exists or learning returns `noop`

Stored artifacts to expect:
- repeated completed activations
- passing review records
- detected pattern
- proposed capability when thresholds are met

### Good fit

- repeated incident response loops
- common migration sequences
- standard refactor patterns
- recurring release checks

## 6. Day-Two Mission Inspection

Use this when a mission is already in progress and you need to recover context
fast without relying on chat history.

### Example flow

1. `roi:inspect`
   Inspect mission summary, latest brief, latest plans, task states, runs,
   policy decisions, patterns, and capability proposals.
2. `roi:draft`
   Resume if the mission is paused or waiting on external work.
3. `roi:review`
   Add new validation evidence once the resumed work finishes.
4. `roi:publish`
   Mark the resumed artifact as ready to hand off.
5. `roi:learn`
   Capture what became reusable after the mission closes.

Expected end state:
- current mission state is inspectable without chat history
- next actions reflect the actual persisted workflow state

### Why this matters

ROI is designed so a software engineer can recover mission state from durable
artifacts instead of reconstructing it from memory.
