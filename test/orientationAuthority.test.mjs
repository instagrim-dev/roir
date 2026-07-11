import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PlanningOrientationSchema } from "../src/contracts.mjs";
import { openDatabase } from "../src/db.mjs";
import { ROIService } from "../src/service.mjs";

test("schema v2 databases acquire the additive orientation checkpoint surface", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-orientation-migration-"));
  const dbPath = path.join(dir, "roi.sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec("CREATE TABLE roi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  legacy.prepare("INSERT INTO roi_meta(key, value) VALUES (?, ?)").run("schema_version", "2");
  legacy.close();

  const db = openDatabase(dbPath);
  t.after(() => {
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(db.prepare("SELECT value FROM roi_meta WHERE key = ?").get("schema_version").value, "3");
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("orientation_checkpoints").name,
    "orientation_checkpoints"
  );
});

test("newer database schemas fail closed", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-orientation-newer-schema-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "roi.sqlite");
  const newer = new DatabaseSync(dbPath);
  newer.exec("CREATE TABLE roi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  newer.prepare("INSERT INTO roi_meta(key, value) VALUES (?, ?)").run("schema_version", "4");
  newer.close();
  assert.throws(() => openDatabase(dbPath), /unsupported newer ROI schema version 4/);
});

function harness(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-orientation-"));
  const db = openDatabase(path.join(dir, "roi.sqlite"));
  t.after(() => {
    try { db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return new ROIService({ db, ...options });
}

function planningOrientation(plan, evidenceSource = "test fixture") {
  return {
    status: "current",
    workspace_root: "roi-test-workspace",
    instruction_sources: ["roi/AGENTS.md"],
    source_artifacts: ["orientation authority fixture"],
    live_state_identity: "fixture:planning-current",
    authority_constraints: ["current checkout only"],
    owner_seams: [{
      id: "OS1",
      owner: plan.name,
      seam: plan.scope || "orientation authority seam",
      evidence_sources: [evidenceSource]
    }],
    material_uncertainties: [],
    proof_obligations: plan.verification_targets.map((target, index) => ({
      id: `PO${index + 1}`,
      obligation: `prove ${target}`,
      owner_seam_ids: ["OS1"],
      verification_targets: [target]
    })),
    execution_preconditions: ["plan revision is current"],
    completion_basis: "owner_seam_coverage_and_material_uncertainty"
  };
}

function seedPlan(service, overrides = {}) {
  const mission = service.missionCreate({
    title: overrides.title || "Orientation mission",
    goal: overrides.goal || "Prove orientation authority"
  }).mission;
  service.briefRevise({
    mission_id: mission.id,
    success_criteria: overrides.verification_targets || ["orientation target"]
  });
  const draft = {
    name: overrides.name || "Orientation plan",
    scope: overrides.scope || "orientation lifecycle",
    actions: overrides.actions || ["apply oriented mutation"],
    verification_targets: overrides.verification_targets || ["orientation target"]
  };
  const plan = service.planGenerate({
    mission_id: mission.id,
    plans: [{ ...draft, planning_orientation: planningOrientation(draft) }]
  }).plans[0];
  return { mission, plan };
}

function refresh(service, plan, options = {}) {
  const verifier = options.action_class?.startsWith("verifier") ?? true;
  const actions = verifier ? plan.verification_targets : plan.actions;
  const nextAction = options.next_action || actions.join("\n");
  return service.orientationRefresh({
    mission_id: plan.mission_id,
    plan_id: plan.id,
    plan_revision: plan.revision,
    run_id: options.run_id || "",
    task_id: options.task_id,
    plan_identity: `${plan.id}@${plan.revision}`,
    live_state_identity: options.live_state_identity || "fixture:live-current",
    current_unit: nextAction,
    next_action: nextAction,
    action_class: options.action_class || "verifier_execution",
    proof_obligation_ids: plan.planning_orientation.proof_obligations.map((item) => item.id),
    proof_targets: plan.verification_targets,
    checked_preconditions: options.checked_preconditions || ["plan, owner seams, and proof targets are current"],
    observed_owner_seam_ids: plan.planning_orientation.owner_seams.map((item) => item.id),
    reason: options.reason || "pre_mutation"
  }).checkpoint;
}

function proofInput(mission, plan, runId = "") {
  return {
    mission_id: mission.id,
    ...(runId ? { run_id: runId } : {}),
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      plan_revision: plan.revision,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "roi/src/service.mjs | 1 +",
        paths_touched: ["roi/src/service.mjs"],
        oracles_run: plan.verification_targets.map((cmd) => ({ cmd, ok: true }))
      }
    }
  };
}

test("planning orientation rejects numeric gates but accepts legacy evidence paths", () => {
  const plan = {
    name: "Gate plan",
    scope: "gate seam",
    verification_targets: ["target"]
  };
  const valid = planningOrientation(plan, "internal/read_limit_v2.go");
  assert.equal(PlanningOrientationSchema.safeParse(valid).success, true);
  assert.equal(
    PlanningOrientationSchema.safeParse({ ...valid, read_threshold: 8 }).success,
    false
  );
  for (const constraint of [
    "edit after 8 reads",
    "perform 8 diagnostic probes before mutation",
    "read count of 8 establishes sufficiency"
  ]) {
    assert.equal(
      PlanningOrientationSchema.safeParse({
        ...valid,
        authority_constraints: [constraint]
      }).success,
      false,
      constraint
    );
  }
  assert.equal(
    PlanningOrientationSchema.safeParse({
      ...valid,
      proof_obligations: [{
        ...valid.proof_obligations[0],
        obligation: "read count >= 8 establishes repair confidence"
      }]
    }).success,
    false
  );
  assert.equal(
    PlanningOrientationSchema.safeParse({
      ...valid,
      authority_constraints: ["read count >= 8"]
    }).success,
    false
  );
});

test("orientation checkpoints persist append-only and bind run and task projections", async (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service);
  const runResult = await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" });
  const verifyTask = service.taskList({ run_id: runResult.run.id }).tasks.find(
    (task) => task.payload.stage_kind === "verify_gate"
  );
  const checkpoint = refresh(service, plan, { run_id: runResult.run.id, task_id: verifyTask.id });

  assert.equal(service.orientationGet({ checkpoint_id: checkpoint.id }).checkpoint.id, checkpoint.id);
  assert.equal(service.orientationList({ plan_id: plan.id }).checkpoints.length, 1);
  assert.ok(service.runGet({ run_id: runResult.run.id }).run.checkpoint_refs.includes(checkpoint.id));
  assert.equal(service.taskList({ run_id: runResult.run.id }).tasks.find((task) => task.id === verifyTask.id).checkpoint_ref, checkpoint.id);
});

test("plan-level invalidation stales every current binding and rejects stale-client branches", async (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service);
  const first = refresh(service, plan, { action_class: "implementation" });
  const second = refresh(service, plan, { action_class: "implementation" });
  assert.throws(
    () => service.orientationInvalidate({ checkpoint_id: first.id, trigger: "compaction" }),
    /not the current binding head/
  );

  const run = (await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" })).run;
  refresh(service, plan, { run_id: run.id, action_class: "implementation" });
  const invalidated = service.orientationInvalidate({
    mission_id: mission.id,
    plan_id: plan.id,
    trigger: "material_live_tree_change",
    reason: "fixture tree changed"
  });
  assert.equal(invalidated.checkpoints.length, 2);
  const latestByRun = new Map();
  for (const checkpoint of service.orientationList({ plan_id: plan.id }).checkpoints) {
    if (!latestByRun.has(checkpoint.run_id)) latestByRun.set(checkpoint.run_id, checkpoint);
  }
  assert.deepEqual([...latestByRun.values()].map((checkpoint) => checkpoint.status), ["stale", "stale"]);
  assert.equal(second.status, "current");
});

test("plan revision invalidates checkpoint history and blocks stale evidence", (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service);
  refresh(service, plan);
  const revised = service.planRevise({
    plan_id: plan.id,
    planning_orientation: {
      ...plan.planning_orientation,
      live_state_identity: "fixture:planning-revised"
    }
  }).plan;

  const latest = service.orientationGet({ mission_id: mission.id, plan_id: plan.id }).checkpoint;
  assert.equal(latest.status, "stale");
  assert.deepEqual(latest.invalidated_by, ["plan_identity_change"]);
  assert.throws(
    () => service.evidenceRecord(proofInput(mission, revised)),
    /orientation/
  );
});

test("material plan revision requires fresh and complete planning orientation", (t) => {
  const service = harness(t);
  const { plan } = seedPlan(service);
  assert.throws(
    () => service.planRevise({ plan_id: plan.id, actions: ["changed action"] }),
    /requires fresh planning_orientation/
  );
  assert.throws(
    () => service.planRevise({
      plan_id: plan.id,
      verification_targets: [...plan.verification_targets, "new target"],
      planning_orientation: {
        ...plan.planning_orientation,
        live_state_identity: "fixture:incomplete-revision"
      }
    }),
    /does not cover verification target/
  );
});

test("quality review reopen requires or derives an affected plan scope", async (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service);
  refresh(service, plan, { action_class: "implementation" });
  assert.throws(
    () => service.evidenceRecord({ mission_id: mission.id, type: "quality_review", result: "reopen" }),
    /requires content.plan_ids or a bound run/
  );
  const run = (await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" })).run;
  refresh(service, plan, { run_id: run.id, action_class: "implementation" });
  const reopened = service.evidenceRecord({
    mission_id: mission.id,
    run_id: run.id,
    type: "quality_review",
    result: "reopen"
  });
  assert.deepEqual(reopened.evidence.content.plan_ids, [plan.id]);
  assert.equal(service.orientationGet({ mission_id: mission.id, plan_id: plan.id }).checkpoint.status, "stale");
});

test("A2A executor dispatch pauses until a task-bound implementation checkpoint exists", async (t) => {
  const executor = {
    calls: 0,
    async invoke() {
      this.calls += 1;
      return { state: "completed", taskId: "remote-1", contextId: "ctx-1", text: "done", artifacts: [] };
    }
  };
  const service = harness(t, { a2aExecutor: executor });
  const { mission, plan } = seedPlan(service);
  const paused = await service.runCreate({
    mission_id: mission.id,
    mode: "a2a",
    a2a_agent_card_url: "https://example.test/card",
    a2a_message: "execute"
  });
  assert.equal(paused.task.blocking_reason, "orientation_refresh_required");
  assert.equal(executor.calls, 0);

  assert.throws(
    () => refresh(service, plan, {
      run_id: paused.run.id,
      task_id: paused.task.id,
      action_class: "implementation",
      checked_preconditions: ["read count >= 8"]
    }),
    /static numeric read\/diagnostic gates/
  );
  assert.throws(
    () => refresh(service, plan, {
      run_id: paused.run.id,
      task_id: paused.task.id,
      action_class: "implementation",
      live_state_identity: "ttl:expired"
    }),
    /telemetry labels cannot establish live-state identity/
  );
  assert.throws(
    () => refresh(service, plan, {
      run_id: paused.run.id,
      task_id: paused.task.id,
      action_class: "implementation",
      checked_preconditions: ["inspection quota 8 satisfied"]
    }),
    /static numeric read\/diagnostic gates/
  );
  assert.throws(
    () => refresh(service, plan, {
      run_id: paused.run.id,
      task_id: paused.task.id,
      action_class: "implementation",
      live_state_identity: "git:abc; ttl=300"
    }),
    /telemetry labels cannot establish live-state identity/
  );

  refresh(service, plan, {
    run_id: paused.run.id,
    task_id: paused.task.id,
    action_class: "implementation"
  });
  const resumed = await service.runResume({ run_id: paused.run.id });
  assert.equal(executor.calls, 1);
  assert.equal(resumed.task.payload.stage_kind, "spec_review");
  assert.equal(resumed.task.blocking_reason, "orientation_refresh_required");
});

test("local and agent executors cannot dispatch before task-bound implementation orientation", async (t) => {
  for (const mode of ["local", "agent"]) {
    const executor = { calls: 0, execute() { this.calls += 1; return "output"; } };
    const service = harness(t, mode === "local" ? { localExecutor: executor } : { agentExecutor: executor });
    const { mission } = seedPlan(service, { title: `${mode} executor mission` });
    const paused = await service.runCreate({ mission_id: mission.id, mode, prompt: "execute" });
    assert.equal(paused.task.payload.stage_kind, "implement");
    assert.equal(paused.task.blocking_reason, "orientation_refresh_required");
    assert.equal(executor.calls, 0);
  }
});

test("automatic review stages require their own task-bound verifier orientation", async (t) => {
  const localExecutor = { calls: 0, execute() { this.calls += 1; return "LOCAL_EXECUTION_COMPLETED"; } };
  const service = harness(t, { localExecutor });
  const { mission, plan } = seedPlan(service);
  let result = await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "execute" });
  refresh(service, plan, {
    run_id: result.run.id,
    task_id: result.task.id,
    action_class: "implementation"
  });
  service.taskResume({ task_id: result.task.id });
  result = await service.runResume({ run_id: result.run.id });
  assert.equal(localExecutor.calls, 1);
  assert.equal(result.task.payload.stage_kind, "spec_review");
  assert.equal(result.task.blocking_reason, "orientation_refresh_required");
  assert.equal(service.reviewList({ run_id: result.run.id }).reviews.length, 0);

  refresh(service, plan, { run_id: result.run.id, task_id: result.task.id });
  service.taskResume({ task_id: result.task.id });
  result = await service.runResume({ run_id: result.run.id });
  assert.equal(result.task.payload.stage_kind, "quality_review");
  assert.equal(result.task.blocking_reason, "orientation_refresh_required");
  assert.equal(service.reviewList({ run_id: result.run.id }).reviews.length, 1);
});

test("run-associated roi:go evidence rejects run-level checkpoint substitution", async (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service);
  const paused = await service.runCreate({ mission_id: mission.id, mode: "agent", prompt: "handoff" });
  refresh(service, plan, { run_id: paused.run.id, action_class: "implementation" });
  refresh(service, plan, { run_id: paused.run.id });
  assert.throws(
    () => service.evidenceRecord(proofInput(mission, plan, paused.run.id)),
    /missing action checkpoint/
  );
  refresh(service, plan, {
    run_id: paused.run.id,
    task_id: paused.task.id,
    action_class: "implementation"
  });
  refresh(service, plan, { run_id: paused.run.id, task_id: paused.task.id });
  const specTask = service.taskList({ run_id: paused.run.id }).tasks.find(
    (task) => task.plan_id === plan.id && task.payload?.stage_kind === "spec_review"
  );
  refresh(service, plan, { run_id: paused.run.id, task_id: specTask.id });
  assert.equal(service.evidenceRecord(proofInput(mission, plan, paused.run.id)).status, "ok");
  const staleReview = await service.runResume({ run_id: paused.run.id });
  assert.equal(staleReview.task.id, specTask.id);
  assert.match(staleReview.failure_reason, /predates latest roi:go evidence/);
  assert.equal(service.reviewList({ run_id: paused.run.id }).reviews.length, 0);
});

test("public task transitions cannot complete service-owned stages", async (t) => {
  const service = harness(t);
  const { mission } = seedPlan(service);
  const run = (await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" })).run;
  for (const task of service.taskList({ run_id: run.id }).tasks) {
    assert.throws(
      () => service.taskTransition({ task_id: task.id, status: "completed" }),
      /cannot complete service-owned/
    );
  }
  assert.equal(service.runGet({ run_id: run.id }).run.status, "paused");
  assert.equal(service.evidenceList({ run_id: run.id }).evidence.filter(
    (item) => item.source === "verify.evaluate"
  ).length, 0);
});

test("stale agent runs cannot execute a newer plan revision", async (t) => {
  const agentExecutor = { calls: 0, async execute() { this.calls += 1; return { output: "handoff" }; } };
  const service = harness(t, { agentExecutor });
  const { mission, plan } = seedPlan(service);
  const paused = await service.runCreate({ mission_id: mission.id, mode: "agent", prompt: "handoff" });
  service.planRevise({
    plan_id: plan.id,
    actions: ["new revision action"],
    planning_orientation: planningOrientation({
      ...plan,
      actions: ["new revision action"]
    })
  });
  await assert.rejects(
    service.runResume({ run_id: paused.run.id }),
    /is stale for plan/
  );
});

test("run creation rejects plans owned by another mission", async (t) => {
  const service = harness(t);
  const { plan } = seedPlan(service, { title: "Mission A" });
  const missionB = service.missionCreate({ title: "Mission B", goal: "Stay isolated" }).mission;
  await assert.rejects(
    service.runCreate({ mission_id: missionB.id, plan_ids: [plan.id], mode: "local" }),
    /do not belong to mission/
  );
  assert.equal(service.runList({ mission_id: missionB.id }).runs.length, 0);
});

test("passing evidence requires mutation checkpoints for every declared action", (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service, { actions: ["action one", "action two"] });
  refresh(service, plan, { action_class: "implementation", next_action: "action one" });
  refresh(service, plan);
  assert.throws(
    () => service.evidenceRecord(proofInput(mission, plan)),
    /missing action checkpoint.*action two/
  );
  refresh(service, plan, { action_class: "implementation", next_action: "action two" });
  assert.equal(service.evidenceRecord(proofInput(mission, plan)).status, "ok");
});

test("partial verification requires explicit semantic scope despite substantive counts", async (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service);
  const run = (await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" })).run;
  refresh(service, plan, { action_class: "implementation" });
  refresh(service, plan);
  service.evidenceRecord(proofInput(mission, plan));
  const verifyTask = service.taskList({ run_id: run.id }).tasks.find(
    (task) => task.plan_id === plan.id && task.payload?.stage_kind === "verify_gate"
  );
  refresh(service, plan, { run_id: run.id, task_id: verifyTask.id });

  assert.throws(
    () => service.verifyEvaluate({
      run_id: run.id,
      verdict: "pass",
      allow_partial_verification: true
    }),
    /explicit scope_plan_ids/
  );
});

test("partial verification reconciles only the explicitly named semantic scope", async (t) => {
  const service = harness(t);
  const mission = service.missionCreate({
    title: "Scoped verification mission",
    goal: "Keep partial verification task reconciliation inside its named scope"
  }).mission;
  service.briefRevise({ mission_id: mission.id, success_criteria: ["A passes", "B passes"] });
  const drafts = ["A", "B"].map((name) => ({
    name: `Plan ${name}`,
    scope: `scope ${name}`,
    actions: [`implement ${name}`],
    verification_targets: [`${name} passes`]
  }));
  const plans = service.planGenerate({
    mission_id: mission.id,
    plans: drafts.map((draft) => ({
      ...draft,
      planning_orientation: planningOrientation(draft)
    }))
  }).plans;
  const run = (await service.runCreate({
    mission_id: mission.id,
    plan_ids: plans.map((plan) => plan.id),
    mode: "local",
    prompt: "scoped verification fixture"
  })).run;

  for (const plan of plans) {
    const implementTask = service.taskList({ run_id: run.id }).tasks.find(
      (task) => task.plan_id === plan.id && task.payload?.stage_kind === "implement"
    );
    refresh(service, plan, { action_class: "implementation", run_id: run.id, task_id: implementTask.id });
    refresh(service, plan, { run_id: run.id, task_id: implementTask.id });
    const proof = proofInput(mission, plan, run.id);
    proof.content.implementation_proof.shared_bundle = true;
    service.evidenceRecord(proof);
  }
  for (const task of service.taskList({ run_id: run.id }).tasks.filter(
    (task) => task.plan_id === plans[0].id && ["spec_review", "quality_review", "verify_gate"].includes(task.payload?.stage_kind)
  )) {
    refresh(service, plans[0], { run_id: run.id, task_id: task.id });
  }
  service.verifyEvaluate({
    run_id: run.id,
    verdict: "pass",
    allow_partial_verification: true,
    scope_plan_ids: [plans[0].id]
  });

  const verifyTasks = service.taskList({ run_id: run.id }).tasks.filter(
    (task) => task.payload?.stage_kind === "verify_gate"
  );
  assert.equal(verifyTasks.find((task) => task.plan_id === plans[0].id).status, "completed");
  assert.notEqual(verifyTasks.find((task) => task.plan_id === plans[1].id).status, "completed");
});

test("partial verification projection reports only run-bound task-admitted candidates", async (t) => {
  const service = harness(t);
  const mission = service.missionCreate({
    title: "Partial projection mission",
    goal: "Expose the next semantically admissible partial scope"
  }).mission;
  service.briefRevise({ mission_id: mission.id, success_criteria: ["A passes", "B passes"] });
  const drafts = ["A", "B"].map((name) => ({
    name: `Plan ${name}`,
    scope: `scope ${name}`,
    actions: [`implement ${name}`],
    verification_targets: [`${name} passes`]
  }));
  const plans = service.planGenerate({
    mission_id: mission.id,
    plans: drafts.map((draft) => ({ ...draft, planning_orientation: planningOrientation(draft) }))
  }).plans;
  const run = (await service.runCreate({
    mission_id: mission.id,
    plan_ids: plans.map((plan) => plan.id),
    mode: "local",
    prompt: "partial projection fixture"
  })).run;
  const implementTask = service.taskList({ run_id: run.id }).tasks.find(
    (task) => task.plan_id === plans[0].id && task.payload?.stage_kind === "implement"
  );
  refresh(service, plans[0], {
    action_class: "implementation",
    run_id: run.id,
    task_id: implementTask.id
  });
  refresh(service, plans[0], { run_id: run.id, task_id: implementTask.id });
  service.evidenceRecord(proofInput(mission, plans[0], run.id));
  for (const task of service.taskList({ run_id: run.id }).tasks.filter(
    (task) => task.plan_id === plans[0].id && ["spec_review", "quality_review", "verify_gate"].includes(task.payload?.stage_kind)
  )) {
    refresh(service, plans[0], { run_id: run.id, task_id: task.id });
  }

  const hint = service.statusGet({ mission_id: mission.id }).summary.partial_verification_eligible;
  assert.equal(hint.eligible, true);
  assert.deepEqual(hint.candidate_plan_ids, [plans[0].id]);
});

test("every verifier verdict requires a task-bound current checkpoint", async (t) => {
  const service = harness(t);
  const { mission, plan } = seedPlan(service);
  const run = (await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" })).run;
  assert.throws(
    () => service.verifyEvaluate({ run_id: run.id, verdict: "fail" }),
    /verification orientation required/
  );
  const verifyTask = service.taskList({ run_id: run.id }).tasks.find(
    (task) => task.plan_id === plan.id && task.payload?.stage_kind === "verify_gate"
  );
  refresh(service, plan, { run_id: run.id, task_id: verifyTask.id });
  assert.equal(service.verifyEvaluate({ run_id: run.id, verdict: "fail" }).verdict, "fail");
});
