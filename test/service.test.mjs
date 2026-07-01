import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { UserBuilder, agentCardHandler, jsonRpcHandler } from "@a2a-js/sdk/server/express";
import {
  CapabilityStatus,
  ReviewVerdict,
  RunStatus,
  StageKind,
  TaskStatus,
  VerifyVerdict
} from "../src/contracts.mjs";
import { openDatabase } from "../src/db.mjs";
import { isHostImplementHandoffOutput, isLocalImplementStubOutput, IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED } from "../src/implementationProof.mjs";
import { ROIService } from "../src/service.mjs";

const routingFixturePath = new URL("../fixtures/routing-evals.json", import.meta.url);
const routingFixtures = JSON.parse(fs.readFileSync(routingFixturePath, "utf8"));

test("ROI routing fixture suite chooses expected capabilities", async (t) => {
  for (const fixture of routingFixtures.cases) {
    await t.test(fixture.name, () => {
      const { service } = createHarness(t);
      const mission = service.missionCreate({
        title: fixture.mission.title,
        goal: fixture.mission.goal
      }).mission;
      service.briefRevise({
        mission_id: mission.id,
        assumptions: fixture.brief.assumptions ?? [],
        constraints: fixture.brief.constraints ?? [],
        success_criteria: fixture.brief.success_criteria ?? []
      });
      const plan = service.planGenerate({
        mission_id: mission.id,
        plans: [fixture.plan]
      }).plans[0];

      assert.equal(plan.capability_id, fixture.expected_capability_id);
      const route = service.routeList({ mission_id: mission.id, plan_id: plan.id }).routing_decisions[0];
      assert.equal(route.capability_id, fixture.expected_capability_id);
    });
  }
});

test("ROI plan generation writes routing decisions and stamps workflow metadata", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    title: "Fix flaky auth regression",
    goal: "Debug and fix the regression in login flow",
    plan: {
      name: "Investigate auth regression",
      actions: ["reproduce failure", "trace root cause", "fix regression"],
      verification_targets: ["Regression is fixed", "Tests cover the issue"]
    }
  });

  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const route = service.routeList({ mission_id: mission.id, plan_id: plan.id }).routing_decisions[0];

  assert.equal(plan.capability_id, "debugging_workflow");
  assert.equal(plan.workflow_template_ref, "debugging_workflow");
  assert.deepEqual(plan.workflow_template, ["implement", "spec_review", "quality_review", "verify_gate"]);
  assert.equal(route.capability_id, "debugging_workflow");
  assert.match(route.reason, /mission:debug|plan:fix|plan:trace/);
});

test("ROI plan generation persists source-contract requirements", (t) => {
  const { service } = createHarness(t);
  const mission = service.missionCreate({
    title: "Roadmap-derived docs work",
    goal: "Preserve roadmap acceptance criteria through ROI execution"
  }).mission;
  service.briefRevise({
    mission_id: mission.id,
    success_criteria: ["Roadmap contract remains represented in proof"]
  });
  const plan = service.planGenerate({
    mission_id: mission.id,
    plans: [
      {
        name: "Selector inventory contract",
        actions: ["Update selector inventory"],
        verification_targets: ["node -e \"process.exit(0)\""],
        source_contract_refs: ["docs/plans/2026-06-30-013-refactor-docs-iteration-roadmap-plan.md"],
        requires_source_contract_check: true
      }
    ]
  }).plans[0];

  assert.deepEqual(plan.source_contract_refs, [
    "docs/plans/2026-06-30-013-refactor-docs-iteration-roadmap-plan.md"
  ]);
  assert.equal(plan.requires_source_contract_check, true);
  assert.deepEqual(service.planList({ mission_id: mission.id }).plans[0].source_contract_refs, plan.source_contract_refs);
});

test("ROI run expands one plan into staged workflow and completes after verify", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];

  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "local",
    prompt: "Implement ROI mission flow"
  });

  assert.equal(runResult.status, "paused");
  assert.equal(runResult.run.status, RunStatus.PAUSED);
  assert.equal(runResult.task.payload.stage_kind, StageKind.VERIFY_GATE);
  const tasks = service.taskList({ run_id: runResult.run.id }).tasks;
  assert.deepEqual(tasks.map((task) => task.payload.stage_kind), [
    StageKind.IMPLEMENT,
    StageKind.SPEC_REVIEW,
    StageKind.QUALITY_REVIEW,
    StageKind.VERIFY_GATE
  ]);
  assert.deepEqual(tasks[1].payload.depends_on_task_ids, [tasks[0].id]);
  assert.deepEqual(tasks[2].payload.depends_on_task_ids, [tasks[1].id]);
  assert.deepEqual(tasks[3].payload.depends_on_task_ids, [tasks[2].id]);

  const reviewsBeforeVerify = service.reviewList({ run_id: runResult.run.id }).reviews;
  assert.deepEqual(reviewsBeforeVerify.map((review) => review.review_type), [
    StageKind.SPEC_REVIEW,
    StageKind.QUALITY_REVIEW
  ]);
  assert.ok(reviewsBeforeVerify.every((review) => review.verdict === ReviewVerdict.PASS));

  recordSubstantiveRoiGoForRun(service, mission.id, runResult.run);
  const verified = service.verifyEvaluate({
    run_id: runResult.run.id,
    verdict: VerifyVerdict.PASS,
    notes: "Green path validated"
  });

  assert.equal(verified.run.status, RunStatus.COMPLETED);
  const finalTasks = service.taskList({ run_id: runResult.run.id }).tasks;
  assert.ok(finalTasks.every((task) => task.status === TaskStatus.COMPLETED));
});

test("ROI evidence_record requires source-contract proof before verify can complete source-derived plans", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    title: "Source contract mission",
    goal: "Implement a roadmap-derived plan without weakening it",
    plan: {
      name: "Roadmap contract plan",
      actions: ["Preserve roadmap fields"],
      verification_targets: ["node -e \"process.exit(0)\""],
      source_contract_refs: ["docs/plans/source-roadmap.md"],
      requires_source_contract_check: true
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const run = (await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "agent",
    prompt: "host handoff"
  })).run;

  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
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
            oracles_run: [{ cmd: plan.verification_targets[0], ok: true }]
          }
        }
      }),
    /source contract coverage/
  );
  assert.equal(service.statusGet({ mission_id: mission.id }).summary.mission_go_progress.complete, false);

  service.evidenceRecord({
    mission_id: mission.id,
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
        oracles_run: [{ cmd: plan.verification_targets[0], ok: true }],
        source_contract: {
          source_refs: ["docs/plans/source-roadmap.md"],
          coverage: [
            {
              requirement: "Roadmap field-level acceptance criteria remain represented",
              disposition: "verification_target",
              verification_target: plan.verification_targets[0]
            }
          ]
        }
      }
    }
  });

  const verified = service.verifyEvaluate({
    run_id: run.id,
    verdict: VerifyVerdict.PASS,
    notes: "Source contract coverage and oracle proof are present"
  });
  assert.equal(verified.run.status, RunStatus.COMPLETED);
});

test("ROI full verify pass reconciles externally satisfied multi-plan workflow ledger", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Plan A",
      actions: ["implement a"],
      verification_targets: ["A holds"]
    }
  });
  service.planGenerate({
    mission_id: mission.id,
    plans: [
      {
        name: "Plan B",
        actions: ["implement b"],
        verification_targets: ["B holds"]
      }
    ]
  });
  const plans = service.planList({ mission_id: mission.id }).plans;
  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: plans.map((plan) => plan.id),
    mode: "local",
    prompt: "stub one plan, then external roi:go satisfies all plans"
  });

  assert.equal(runResult.run.status, RunStatus.PAUSED);
  assert.ok(
    service.taskList({ run_id: runResult.run.id }).tasks.some((task) => task.status === TaskStatus.QUEUED),
    "multi-plan local run should still have queued workflow tasks before external roi:go reconciliation"
  );
  for (const plan of plans) {
    recordSubstantiveRoiGo(service, mission.id, plan);
  }

  const verified = service.verifyEvaluate({
    run_id: runResult.run.id,
    verdict: VerifyVerdict.PASS,
    notes: "mission-level roi:go evidence satisfies all run plans"
  });

  assert.equal(verified.run.status, RunStatus.COMPLETED);
  assert.equal(verified.run.summary, "Review pass");
  assert.deepEqual(verified.next_actions, ["roi:publish", "roi:learn"]);
  assert.ok(
    service.taskList({ run_id: runResult.run.id }).tasks.every((task) => task.status === TaskStatus.COMPLETED),
    "full verify pass should close queued workflow ledger tasks through roi:go-backed reconciliation"
  );
  const reviewTypes = service.reviewList({ run_id: runResult.run.id }).reviews.map((review) => review.review_type);
  assert.ok(reviewTypes.filter((type) => type === StageKind.SPEC_REVIEW).length >= 2);
  assert.ok(reviewTypes.filter((type) => type === StageKind.QUALITY_REVIEW).length >= 2);
  assert.ok(reviewTypes.filter((type) => type === StageKind.VERIFY_GATE).length >= 1);
  assert.deepEqual(service.statusGet({ mission_id: mission.id }).summary.next_actions, ["roi:publish", "roi:learn"]);
});

test("ROI verifyEvaluate pass reconciles agent handoff with review records before completion", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Agent handoff",
      actions: ["implement in host"],
      verification_targets: ['node -e "process.exit(0)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const run = (await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "agent",
    prompt: "host handoff"
  })).run;

  assert.equal(run.status, RunStatus.PAUSED);
  assert.deepEqual(
    service.taskList({ run_id: run.id }).tasks.map((task) => [task.payload.stage_kind, task.status]),
    [
      [StageKind.IMPLEMENT, TaskStatus.INPUT_REQUIRED],
      [StageKind.SPEC_REVIEW, TaskStatus.QUEUED],
      [StageKind.QUALITY_REVIEW, TaskStatus.QUEUED],
      [StageKind.VERIFY_GATE, TaskStatus.QUEUED]
    ]
  );
  recordSubstantiveRoiGo(service, mission.id, plan);

  const verified = service.verifyEvaluate({
    run_id: run.id,
    verdict: VerifyVerdict.PASS,
    notes: "terminal pass must reconcile lane proof"
  });

  assert.equal(verified.run.status, RunStatus.COMPLETED);
  assert.ok(service.taskList({ run_id: run.id }).tasks.every((task) => task.status === TaskStatus.COMPLETED));
  const reviews = service.reviewList({ run_id: run.id }).reviews;
  assert.ok(reviews.some((review) => review.review_type === StageKind.SPEC_REVIEW));
  assert.ok(reviews.some((review) => review.review_type === StageKind.QUALITY_REVIEW));
  assert.ok(reviews.some((review) => review.review_type === StageKind.VERIFY_GATE));
  const evidence = service.evidenceList({ mission_id: mission.id, run_id: run.id }).evidence;
  assert.ok(evidence.some((item) => item.source === "roi_go_reconciler" && item.artifact_ref));
});

test("ROI status_get hides superseded blocking reviews", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const run = (await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "agent",
    prompt: "manual review supersession"
  })).run;
  const task = service.taskList({ run_id: run.id }).tasks[0];

  service.reviewRecord({
    mission_id: mission.id,
    run_id: run.id,
    task_id: task.id,
    activation_id: task.payload.activation_id,
    review_type: StageKind.SPEC_REVIEW,
    subject_ref: task.id,
    verdict: ReviewVerdict.FAIL,
    blocking_issues: ["stale_failure"]
  });
  assert.equal(service.statusGet({ mission_id: mission.id }).summary.blocking_issues.length, 1);

  service.reviewRecord({
    mission_id: mission.id,
    run_id: run.id,
    task_id: task.id,
    activation_id: task.payload.activation_id,
    review_type: StageKind.SPEC_REVIEW,
    subject_ref: task.id,
    verdict: ReviewVerdict.PASS,
    blocking_issues: []
  });

  assert.deepEqual(service.statusGet({ mission_id: mission.id }).summary.blocking_issues, []);
});

test("ROI failed spec review pauses the run and blocks later stages", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Underspecified workflow",
      actions: ["write code"],
      verification_targets: []
    }
  });

  const runResult = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "Implement without targets"
  });

  assert.equal(runResult.status, "paused");
  assert.equal(runResult.run.status, RunStatus.PAUSED);
  assert.equal(runResult.task.payload.stage_kind, StageKind.SPEC_REVIEW);
  const reviews = service.reviewList({ run_id: runResult.run.id }).reviews;
  assert.equal(reviews[0].review_type, StageKind.SPEC_REVIEW);
  assert.equal(reviews[0].verdict, ReviewVerdict.FAIL);
  assert.ok(reviews[0].blocking_issues.includes("missing_verification_targets"));

  const tasks = service.taskList({ run_id: runResult.run.id }).tasks;
  assert.equal(tasks[2].status, TaskStatus.QUEUED);
  assert.equal(tasks[3].status, TaskStatus.QUEUED);
});

test("ROI failed quality review pauses the run without corrupting earlier artifacts", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);

  const runResult = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "Implement with UNVERIFIED_COMPLETION_CLAIM marker"
  });

  assert.equal(runResult.status, "paused");
  assert.equal(runResult.run.status, RunStatus.PAUSED);
  assert.equal(runResult.task.payload.stage_kind, StageKind.QUALITY_REVIEW);

  const reviews = service.reviewList({ run_id: runResult.run.id }).reviews;
  const qualityReview = reviews.find((review) => review.review_type === StageKind.QUALITY_REVIEW);
  assert.equal(qualityReview.verdict, ReviewVerdict.FAIL);
  assert.ok(qualityReview.blocking_issues.includes("unverified_completion_claim"));

  const evidence = service.evidenceList({ mission_id: mission.id, run_id: runResult.run.id }).evidence;
  assert.equal(evidence.filter((item) => item.type === "execution_output").length, 1);
});

test("ROI inspect shows routing, activations, reviews, blocking state, and learning readiness", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);

  const runResult = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "Implement ROI mission flow"
  });

  const status = service.statusGet({ mission_id: mission.id });
  assert.equal(status.summary.routing_decisions.length, 1);
  assert.equal(status.summary.capability_activations.length, 1);
  assert.equal(status.summary.review_records.length, 2);
  assert.equal(status.summary.blocking_issues.length, 0);
  assert.equal(status.summary.tasks.length, 4);
  assert.equal(status.summary.tasks.at(-1).status, TaskStatus.INPUT_REQUIRED);
  assert.equal(status.summary.learning_readiness[0].successful_activations, 0);

  recordSubstantiveRoiGoForRun(service, mission.id, runResult.run);
  service.verifyEvaluate({ run_id: runResult.run.id, verdict: VerifyVerdict.PASS, notes: "done" });
  const afterVerify = service.statusGet({ mission_id: mission.id });
  assert.equal(afterVerify.summary.review_records.length, 3);
  assert.equal(afterVerify.summary.runs[0].status, RunStatus.COMPLETED);
});

test("ROI convergence outline elects an active seam and surfaces inspectable rationale", (t) => {
  const { service } = createHarness(t);
  const mission = seedConvergenceMission(service);

  const outlined = service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "Harden publish finalization",
        summary: "Add a durable publish finalization boundary",
        expected_maturity_gain: 2,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.8,
        requires_judgment: false,
        plan: {
          actions: ["Finalize published seam state"],
          verification_targets: ["Publish finalization is durable"]
        }
      },
      {
        title: "Add host bridge",
        summary: "Expose convergence status in the host",
        expected_maturity_gain: 1,
        advances_to: "shipped",
        unlock_score: 0,
        evidence_confidence: 0.4,
        requires_judgment: true,
        plan: {
          actions: ["Surface convergence status"],
          verification_targets: ["Host shows convergence status"]
        }
      }
    ]
  });

  assert.deepEqual(outlined.next_actions, ["roi:draft"]);
  assert.equal(outlined.plans.length, 2);
  assert.ok(outlined.plans.every((plan) => plan.convergence_seam_id));

  const status = service.statusGet({ mission_id: mission.id });
  assert.equal(status.summary.convergence.controller.state, "active");
  assert.equal(status.summary.convergence.active_seam.title, "Harden publish finalization");
  assert.equal(status.summary.convergence.controller.active_plan_id, status.summary.convergence.active_plan.id);
  assert.equal(status.summary.convergence.controller.election.scoring.expected_maturity_gain, 2);
  assert.deepEqual(status.summary.next_actions, ["roi:go", "roi:draft", "roi:inspect"]);
});

test("ROI convergence run creation rejects non-active seam plans", async (t) => {
  const { service } = createHarness(t);
  const mission = seedConvergenceMission(service);

  const outlined = service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "First seam",
        summary: "Top-ranked active seam",
        expected_maturity_gain: 3,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.7,
        requires_judgment: false,
        plan: {
          actions: ["Run first seam"],
          verification_targets: ["First seam completes"]
        }
      },
      {
        title: "Second seam",
        summary: "Lower-priority seam",
        expected_maturity_gain: 1,
        advances_to: "shipped",
        unlock_score: 0,
        evidence_confidence: 0.2,
        requires_judgment: false,
        plan: {
          actions: ["Run second seam"],
          verification_targets: ["Second seam completes"]
        }
      }
    ]
  });

  const inactivePlan = outlined.plans.find(
    (plan) => plan.id !== service.statusGet({ mission_id: mission.id }).summary.convergence.controller.active_plan_id
  );
  await assert.rejects(
    service.runCreate({
      mission_id: mission.id,
      plan_ids: [inactivePlan.id],
      mode: "local",
      prompt: "Attempt to bypass the active seam"
    }),
    /only execute the elected plan|only run active plan|may only run active plan/
  );
});

test("ROI convergence publication finalization advances maturity and re-elects the next seam", async (t) => {
  const { service } = createHarness(t);
  const mission = seedConvergenceMission(service);

  service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "Stabilize publish boundary",
        summary: "Make publish durable",
        expected_maturity_gain: 2,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.8,
        requires_judgment: false,
        plan: {
          actions: ["Finalize seam one"],
          verification_targets: ["Seam one publishes"]
        }
      },
      {
        title: "Ship remaining seam",
        summary: "Finish the declared manifest",
        expected_maturity_gain: 1,
        advances_to: "shipped",
        unlock_score: 0,
        evidence_confidence: 0.5,
        requires_judgment: false,
        plan: {
          actions: ["Finalize seam two"],
          verification_targets: ["Seam two publishes"]
        }
      }
    ]
  });

  const firstRun = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "Run the first convergence seam"
  });
  recordSubstantiveRoiGoForRun(service, mission.id, firstRun.run);
  service.verifyEvaluate({ run_id: firstRun.run.id, verdict: VerifyVerdict.PASS, notes: "ready to publish" });
  service.evidenceRecord({
    mission_id: mission.id,
    run_id: firstRun.run.id,
    type: "publication",
    source: "service.test",
    result: "Published seam one",
    artifact_ref: "docs/seam-one.md",
    content: {}
  });

  const afterFirstPublish = service.statusGet({ mission_id: mission.id });
  assert.equal(afterFirstPublish.summary.convergence.controller.current_maturity, "reviewed");
  assert.equal(afterFirstPublish.summary.convergence.active_seam.title, "Ship remaining seam");
  assert.deepEqual(afterFirstPublish.summary.next_actions, ["roi:go", "roi:draft", "roi:inspect"]);

  const secondRun = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "Run the second convergence seam"
  });
  recordSubstantiveRoiGoForRun(service, mission.id, secondRun.run);
  service.verifyEvaluate({ run_id: secondRun.run.id, verdict: VerifyVerdict.PASS, notes: "ready to publish" });
  service.evidenceRecord({
    mission_id: mission.id,
    run_id: secondRun.run.id,
    type: "publication",
    source: "service.test",
    result: "Published seam two",
    artifact_ref: "docs/seam-two.md",
    content: {}
  });

  const finalState = service.statusGet({ mission_id: mission.id });
  assert.equal(finalState.summary.convergence.controller.current_maturity, "shipped");
  assert.equal(finalState.summary.convergence.controller.state, "converged");
  assert.deepEqual(finalState.summary.next_actions, ["roi:learn", "roi:inspect"]);
});

test("ROI convergence publication must use a run from the same mission", async (t) => {
  const { service } = createHarness(t);
  const convergenceMission = seedConvergenceMission(service);
  service.planGenerate({
    mission_id: convergenceMission.id,
    seams: [
      {
        title: "Convergence seam",
        summary: "Owns convergence publication",
        expected_maturity_gain: 1,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.7,
        requires_judgment: false,
        plan: {
          actions: ["Publish the convergence seam"],
          verification_targets: ["Publication finalization is durable"]
        }
      }
    ]
  });

  const otherMission = seedMission(service, {
    title: "Unrelated mission",
    goal: "Exercise an unrelated non-convergence run"
  });
  const otherRun = await service.runCreate({
    mission_id: otherMission.id,
    mode: "local",
    prompt: "Complete unrelated mission"
  });
  recordSubstantiveRoiGoForRun(service, otherMission.id, otherRun.run);
  service.verifyEvaluate({ run_id: otherRun.run.id, verdict: VerifyVerdict.PASS, notes: "unrelated run completed" });

  assert.throws(
    () => service.evidenceRecord({
      mission_id: convergenceMission.id,
      run_id: otherRun.run.id,
      type: "publication",
      source: "service.test",
      result: "Attempt cross-mission publication",
      artifact_ref: "docs/cross-mission.md",
      content: {}
    }),
    /does not belong to mission/
  );

  const convergenceStatus = service.statusGet({ mission_id: convergenceMission.id });
  assert.equal(convergenceStatus.summary.convergence.controller.current_maturity, "drafted");
  assert.equal(convergenceStatus.summary.convergence.active_seam.title, "Convergence seam");
  const otherEvidence = service.evidenceList({ mission_id: otherMission.id, run_id: otherRun.run.id }).evidence;
  assert.equal(otherEvidence.filter((item) => item.type === "publication").length, 0);
});

test("ROI convergence publication requires a completed run", (t) => {
  const { service } = createHarness(t);
  const mission = seedConvergenceMission(service);
  service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "Convergence seam",
        summary: "Needs a completed run before publish",
        expected_maturity_gain: 1,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.7,
        requires_judgment: false,
        plan: {
          actions: ["Publish the convergence seam"],
          verification_targets: ["Publication finalization is durable"]
        }
      }
    ]
  });

  assert.throws(
    () => service.evidenceRecord({
      mission_id: mission.id,
      type: "publication",
      source: "service.test",
      result: "Attempt publish without run",
      artifact_ref: "docs/no-run.md",
      content: {}
    }),
    /publication evidence requires run_id/
  );

  const evidence = service.evidenceList({ mission_id: mission.id }).evidence;
  assert.equal(evidence.filter((item) => item.type === "publication").length, 0);
});

test("ROI publication evidence requires a completed regular run", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Publish guard",
      actions: ["implement before publishing"],
      verification_targets: ['node -e "process.exit(0)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const run = (await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "agent",
    prompt: "host handoff"
  })).run;

  assert.equal(run.status, RunStatus.PAUSED);
  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
        run_id: run.id,
        type: "publication",
        source: "roi:publish",
        result: "pass",
        artifact_ref: "docs/premature.md",
        content: { summary: "premature publication" }
      }),
    /not publishable/
  );
  assert.equal(
    service.evidenceList({ mission_id: mission.id }).evidence.filter((item) => item.type === "publication").length,
    0
  );
});

test("ROI convergence plans cannot be rebound to a different seam on revision", (t) => {
  const { service } = createHarness(t);
  const mission = seedConvergenceMission(service);
  const outlined = service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "First seam",
        summary: "Initial seam binding",
        expected_maturity_gain: 2,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.8,
        requires_judgment: false,
        plan: {
          actions: ["Run first seam"],
          verification_targets: ["First seam completes"]
        }
      },
      {
        title: "Second seam",
        summary: "Separate seam binding",
        expected_maturity_gain: 1,
        advances_to: "shipped",
        unlock_score: 0,
        evidence_confidence: 0.3,
        requires_judgment: false,
        plan: {
          actions: ["Run second seam"],
          verification_targets: ["Second seam completes"]
        }
      }
    ]
  });

  const firstPlan = outlined.plans.find((plan) => plan.name === "First seam");
  const secondPlan = outlined.plans.find((plan) => plan.name === "Second seam");
  assert.throws(
    () => service.planRevise({
      plan_id: firstPlan.id,
      convergence_seam_id: secondPlan.convergence_seam_id
    }),
    /already bound to convergence seam/
  );
});

test("ROI convergence distinguishes paused-for-judgment from blocked seams", (t) => {
  const { service } = createHarness(t);
  const judgmentMission = seedConvergenceMission(service, { title: "Judgment mission" });
  service.planGenerate({
    mission_id: judgmentMission.id,
    seams: [
      {
        title: "Highest value architectural fork",
        summary: "Needs an operator decision",
        expected_maturity_gain: 3,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.9,
        requires_judgment: true,
        plan: {
          actions: ["Wait for architecture choice"],
          verification_targets: ["Architecture choice recorded"]
        }
      },
      {
        title: "Lower-value seam",
        summary: "Would be runnable if the controller skipped the top seam",
        expected_maturity_gain: 1,
        advances_to: "reviewed",
        unlock_score: 0,
        evidence_confidence: 0.4,
        requires_judgment: false,
        plan: {
          actions: ["Do lower-value work"],
          verification_targets: ["Lower-value work complete"]
        }
      }
    ]
  });
  const judgmentState = service.statusGet({ mission_id: judgmentMission.id });
  assert.equal(judgmentState.summary.convergence.controller.state, "paused_for_judgment");
  assert.deepEqual(judgmentState.summary.next_actions, ["roi:inspect"]);

  const blockedMission = seedConvergenceMission(service, { title: "Blocked mission" });
  service.planGenerate({
    mission_id: blockedMission.id,
    seams: [
      {
        title: "Blocked top seam",
        summary: "Depends on an external prerequisite",
        expected_maturity_gain: 3,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.8,
        requires_judgment: false,
        blocked_by: ["waiting_on_external_api"],
        plan: {
          actions: ["Wait on external API"],
          verification_targets: ["External dependency clears"]
        }
      },
      {
        title: "Lower-value seam",
        summary: "Runnable but not allowed to leapfrog the blocked top seam",
        expected_maturity_gain: 1,
        advances_to: "reviewed",
        unlock_score: 0,
        evidence_confidence: 0.3,
        requires_judgment: false,
        plan: {
          actions: ["Do lower-value work"],
          verification_targets: ["Lower-value work complete"]
        }
      }
    ]
  });
  const blockedState = service.statusGet({ mission_id: blockedMission.id });
  assert.equal(blockedState.summary.convergence.controller.state, "blocked");
  assert.deepEqual(blockedState.summary.next_actions, ["roi:inspect"]);
});

test("ROI enlightenment proposes a capability only after repeated successful activations", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);

  for (let index = 0; index < 3; index += 1) {
    const runResult = await service.runCreate({
      mission_id: mission.id,
      mode: "local",
      prompt: `Run ${index + 1}`
    });
    recordSubstantiveRoiGoForRun(service, mission.id, runResult.run);
    service.verifyEvaluate({
      run_id: runResult.run.id,
      verdict: VerifyVerdict.PASS,
      notes: `verified ${index + 1}`
    });
  }

  const enlightenment = service.enlightenRun({ mission_id: mission.id });
  assert.equal(enlightenment.status, "ok");
  assert.equal(enlightenment.patterns.length, 1);
  assert.equal(enlightenment.patterns[0].frequency, 3);
  assert.equal(enlightenment.capabilities[0].status, CapabilityStatus.PROPOSED);
});

test("ROI convergence learning adds bounded recommendation hints without changing policy", async (t) => {
  const { service } = createHarness(t);
  const mission = seedConvergenceMission(service, {
    title: "Learning mission",
    target_maturity: "scaled",
    maturity_ladder: ["drafted", "reviewed", "shipped", "scaled"]
  });

  service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "Seam one",
        summary: "First seam",
        expected_maturity_gain: 3,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.7,
        requires_judgment: false,
        plan: { actions: ["Run seam one"], verification_targets: ["Seam one complete"] }
      },
      {
        title: "Seam two",
        summary: "Second seam",
        expected_maturity_gain: 2,
        advances_to: "shipped",
        unlock_score: 1,
        evidence_confidence: 0.6,
        requires_judgment: false,
        plan: { actions: ["Run seam two"], verification_targets: ["Seam two complete"] }
      },
      {
        title: "Seam three",
        summary: "Third seam",
        expected_maturity_gain: 1,
        advances_to: "scaled",
        unlock_score: 1,
        evidence_confidence: 0.5,
        requires_judgment: false,
        plan: { actions: ["Run seam three"], verification_targets: ["Seam three complete"] }
      },
      {
        title: "Remaining seam",
        summary: "Candidate left for learning hints",
        expected_maturity_gain: 1,
        advances_to: "scaled",
        unlock_score: 0,
        evidence_confidence: 0.2,
        requires_judgment: false,
        plan: { actions: ["Run remaining seam"], verification_targets: ["Remaining seam complete"] }
      }
    ]
  });

  for (const label of ["one", "two", "three"]) {
    const drafted = await service.runCreate({
      mission_id: mission.id,
      mode: "local",
      prompt: `Run seam ${label}`
    });
    recordSubstantiveRoiGoForRun(service, mission.id, drafted.run);
    service.verifyEvaluate({ run_id: drafted.run.id, verdict: VerifyVerdict.PASS, notes: `verified ${label}` });
    service.evidenceRecord({
      mission_id: mission.id,
      run_id: drafted.run.id,
      type: "publication",
      source: "service.test",
      result: `Published seam ${label}`,
      artifact_ref: `docs/seam-${label}.md`,
      content: {}
    });
  }

  const learned = service.enlightenRun({ mission_id: mission.id });
  assert.equal(learned.status, "ok");
  assert.ok(learned.convergence_learning.length >= 1);

  const status = service.statusGet({ mission_id: mission.id });
  assert.equal(status.summary.convergence.controller.autonomy_mode, "auto_low_judgment");
  assert.equal(status.summary.convergence.controller.target_maturity, "scaled");
  assert.ok(status.summary.convergence.learned_adjustments.length >= 1);
  assert.ok(status.summary.convergence.learned_adjustments[0].learned_adjustments.evidence_confidence_delta > 0);
});

test("ROI policy denial still blocks before workflow execution", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);

  const blocked = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "rm -rf /tmp/roi-danger"
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.run.status, RunStatus.BLOCKED);
  assert.equal(blocked.task.status, TaskStatus.APPROVAL_REQUIRED);
});

test("ROI resumes a paused A2A task from persisted state and reaches verification gate", async (t) => {
  const dbPath = path.join(createTempDir(t), "roi.sqlite");
  const firstDB = openDatabase(dbPath);
  t.after(() => {
    try {
      firstDB.close?.();
    } catch {}
  });

  const pendingExecutor = new StatefulA2AExecutor();
  const service = new ROIService({ db: firstDB, a2aExecutor: pendingExecutor });
  const mission = seedMission(service);

  const paused = await service.runCreate({
    mission_id: mission.id,
    mode: "a2a",
    a2a_agent_card_url: "http://example.test",
    a2a_message: "Perform remote execution"
  });

  assert.equal(paused.status, "paused");
  assert.equal(paused.task.payload.stage_kind, StageKind.IMPLEMENT);
  assert.equal(paused.task.status, TaskStatus.WAITING_ON_EXTERNAL);

  firstDB.close?.();

  const secondDB = openDatabase(dbPath);
  t.after(() => {
    try {
      secondDB.close?.();
    } catch {}
  });
  const resumedService = new ROIService({ db: secondDB, a2aExecutor: pendingExecutor });

  const resumed = await resumedService.runResume({ run_id: paused.run.id });
  assert.equal(resumed.status, "paused");
  assert.equal(resumed.run.status, RunStatus.PAUSED);
  assert.equal(resumed.task.payload.stage_kind, StageKind.VERIFY_GATE);
});

test("ROI convergence run resume rejects a stale seam after re-election", async (t) => {
  const db = openDatabase(path.join(createTempDir(t), "roi.sqlite"));
  t.after(() => {
    try {
      db.close?.();
    } catch {}
  });
  const service = new ROIService({ db, a2aExecutor: new StatefulA2AExecutor() });
  const mission = seedConvergenceMission(service);

  const outlined = service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "First seam",
        summary: "Initially highest priority",
        expected_maturity_gain: 3,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.7,
        requires_judgment: false,
        plan: {
          actions: ["Run first seam"],
          verification_targets: ["First seam completes"]
        }
      },
      {
        title: "Second seam",
        summary: "Starts lower priority",
        expected_maturity_gain: 1,
        advances_to: "shipped",
        unlock_score: 0,
        evidence_confidence: 0.2,
        requires_judgment: false,
        plan: {
          actions: ["Run second seam"],
          verification_targets: ["Second seam completes"]
        }
      }
    ]
  });

  const firstPlan = outlined.plans.find((plan) => plan.name === "First seam");
  const secondPlan = outlined.plans.find((plan) => plan.name === "Second seam");
  const paused = await service.runCreate({
    mission_id: mission.id,
    mode: "a2a",
    a2a_agent_card_url: "http://example.test",
    a2a_message: "Perform remote convergence execution"
  });

  assert.equal(paused.task.payload.stage_kind, StageKind.IMPLEMENT);
  assert.equal(paused.task.status, TaskStatus.WAITING_ON_EXTERNAL);

  service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        id: firstPlan.convergence_seam_id,
        title: "First seam",
        summary: "Dropped in priority after replanning",
        expected_maturity_gain: 1,
        advances_to: "reviewed",
        unlock_score: 0,
        evidence_confidence: 0.1,
        requires_judgment: false,
        plan: {
          actions: ["Run first seam"],
          verification_targets: ["First seam completes"]
        }
      },
      {
        id: secondPlan.convergence_seam_id,
        title: "Second seam",
        summary: "Replanned to be the next active seam",
        expected_maturity_gain: 4,
        advances_to: "shipped",
        unlock_score: 2,
        evidence_confidence: 0.9,
        requires_judgment: false,
        plan: {
          actions: ["Run second seam"],
          verification_targets: ["Second seam completes"]
        }
      }
    ]
  });

  const status = service.statusGet({ mission_id: mission.id });
  assert.equal(status.summary.convergence.active_seam.title, "Second seam");
  await assert.rejects(
    service.runResume({ run_id: paused.run.id }),
    /may only run active plan/
  );
});

test("ROI convergence completed runs still resume as noop", async (t) => {
  const { service } = createHarness(t);
  const mission = seedConvergenceMission(service, {
    current_maturity: "drafted",
    target_maturity: "reviewed",
    maturity_ladder: ["drafted", "reviewed"]
  });
  service.planGenerate({
    mission_id: mission.id,
    seams: [
      {
        title: "Only seam",
        summary: "Completes the declared manifest",
        expected_maturity_gain: 1,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.8,
        requires_judgment: false,
        plan: {
          actions: ["Run only seam"],
          verification_targets: ["Only seam publishes"]
        }
      }
    ]
  });

  const run = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "Run the only convergence seam"
  });
  recordSubstantiveRoiGoForRun(service, mission.id, run.run);
  service.verifyEvaluate({ run_id: run.run.id, verdict: VerifyVerdict.PASS, notes: "ready to publish" });
  service.evidenceRecord({
    mission_id: mission.id,
    run_id: run.run.id,
    type: "publication",
    source: "service.test",
    result: "Published only seam",
    artifact_ref: "docs/only-seam.md",
    content: {}
  });

  const resumed = await service.runResume({ run_id: run.run.id });
  assert.equal(resumed.status, "noop");
  assert.equal(resumed.run.status, RunStatus.COMPLETED);
});

test("ROI executes a real bounded A2A delegation using the SDK client", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const remote = await startA2ATestServer(t);

  const result = await service.runCreate({
    mission_id: mission.id,
    mode: "a2a",
    a2a_agent_card_url: remote.baseUrl,
    a2a_message: "Handle the delegated task"
  });

  assert.equal(result.status, "paused");
  assert.equal(result.task.payload.stage_kind, StageKind.VERIFY_GATE);
  assert.equal(service.protocolListBindings({ run_id: result.run.id }).protocol_bindings[0].protocol, "a2a");

  recordSubstantiveRoiGoForRun(service, mission.id, result.run);
  const verified = service.verifyEvaluate({
    run_id: result.run.id,
    verdict: VerifyVerdict.PASS,
    notes: "A2A verified"
  });
  assert.equal(verified.run.status, RunStatus.COMPLETED);
});

test("ROI runCancel is a no-op on a terminal run and does not rewrite status", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const run = (await service.runCreate({ mission_id: mission.id, mode: "agent" })).run;

  const cancelled = service.runCancel({ run_id: run.id });
  assert.equal(cancelled.status, "ok");
  assert.equal(cancelled.run.status, RunStatus.CANCELLED);

  // A second cancel (or cancel of any already-terminal run) must not mutate it.
  const again = service.runCancel({ run_id: run.id });
  assert.equal(again.status, "noop");
  assert.match(again.summary, /already cancelled/);
  assert.equal(service.runGet({ run_id: run.id }).run.status, RunStatus.CANCELLED);
});

function createHarness(t) {
  const dir = createTempDir(t);
  const db = openDatabase(path.join(dir, "roi.sqlite"));
  t.after(() => {
    try {
      db.close?.();
    } catch {}
  });
  return {
    db,
    service: new ROIService({ db })
  };
}

function createTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-test-"));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function recordSubstantiveRoiGo(service, missionId, plan) {
  const targets = plan.verification_targets ?? [];
  const actions = plan.actions ?? [];
  if (!targets.length && !actions.length) {
    return null;
  }
  const planKey = String(plan.id).slice(-8);
  return service.evidenceRecord({
    mission_id: missionId,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: `bmo/go.mod | plan-${planKey} | 0 +0`,
        paths_touched: ["bmo/go.mod"],
        oracles_run: (targets.length ? [{ cmd: targets[0], ok: true }] : [])
      }
    }
  });
}

function recordSubstantiveRoiGoForRun(service, missionId, run) {
  const plans = service.planList({ mission_id: missionId }).plans;
  const planIds = new Set((run.plan_ids ?? []).map((id) => String(id)));
  for (const plan of plans) {
    if (!planIds.size || planIds.has(plan.id)) {
      recordSubstantiveRoiGo(service, missionId, plan);
    }
  }
}

function seedMission(service, overrides = {}) {
  const mission = service.missionCreate({
    title: overrides.title || "Seed ROI mission",
    goal: overrides.goal || "Exercise the ROI lifecycle"
  }).mission;
  service.briefRevise({
    mission_id: mission.id,
    assumptions: overrides.assumptions || ["This test owns the mission"],
    success_criteria: overrides.success_criteria || ["Run artifacts are durable"]
  });
  service.planGenerate({
    mission_id: mission.id,
    plans: [
      overrides.plan || {
        name: "Exercise the lifecycle",
        actions: ["run mission", "verify mission"],
        verification_targets: ["Run artifacts are durable"]
      }
    ]
  });
  return mission;
}

function seedConvergenceMission(service, overrides = {}) {
  const mission = service.missionCreate({
    title: overrides.title || "Seed ROI convergence mission",
    goal: overrides.goal || "Exercise the ROI convergence lifecycle",
    convergence: {
      domain: overrides.domain || "Mission Control",
      current_maturity: overrides.current_maturity || "drafted",
      target_maturity: overrides.target_maturity || "shipped",
      maturity_ladder: overrides.maturity_ladder || ["drafted", "reviewed", "shipped"],
      autonomy_mode: overrides.autonomy_mode || "auto_low_judgment"
    }
  }).mission;
  service.briefRevise({
    mission_id: mission.id,
    assumptions: overrides.assumptions || ["This test owns the convergence mission"],
    success_criteria: overrides.success_criteria || ["Convergence state is inspectable"]
  });
  return mission;
}

class StatefulA2AExecutor {
  constructor() {
    this.taskId = `remote-task-${crypto.randomUUID()}`;
    this.contextId = `remote-context-${crypto.randomUUID()}`;
    this.calls = 0;
  }

  async invoke({ taskId = "" }) {
    this.calls += 1;
    if (!taskId) {
      return {
        taskId: this.taskId,
        contextId: this.contextId,
        text: "Remote task accepted",
        artifacts: [],
        statusMessage: "submitted",
        state: "working",
        errorMessage: ""
      };
    }

    return {
      taskId: this.taskId,
      contextId: this.contextId,
      text: "Remote task complete",
      artifacts: [],
      statusMessage: "completed",
      state: "completed",
      errorMessage: ""
    };
  }
}

async function startA2ATestServer(t) {
  const app = express();
  const card = {
    name: "ROI Test Agent",
    description: "A bounded remote agent for ROI integration tests.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: "http://127.0.0.1:0/a2a/jsonrpc",
    skills: [
      {
        id: "delegated-task",
        name: "Delegated Task",
        description: "Handles one bounded ROI remote task.",
        tags: ["roi", "test"]
      }
    ],
    capabilities: {
      pushNotifications: false
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"]
  };

  const requestHandler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    new TestA2AAgentExecutor()
  );

  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use("/a2a/jsonrpc", jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  const server = await listen(app);
  t.after(async () => {
    await closeServer(server);
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  card.url = `${baseUrl}/a2a/jsonrpc`;
  card.additionalInterfaces = [
    {
      url: `${baseUrl}/a2a/jsonrpc`,
      transport: "JSONRPC"
    }
  ];

  return { baseUrl };
}

test("statusGet summary includes trace_count and evidence_count", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);

  // Initially both counts are zero.
  let status = service.statusGet({ mission_id: mission.id });
  assert.equal(status.summary.trace_count, 0, "trace_count starts at zero");
  assert.equal(status.summary.evidence_count, 0, "evidence_count starts at zero");

  // Record a trace and evidence directly against the mission (no run needed).
  service.traceRecord({
    mission_id: mission.id,
    events: ["step executed"],
    tool_calls: [],
    latency_ms: 42
  });
  service.evidenceRecord({
    mission_id: mission.id,
    type: "artifact",
    content: { text: "Draft complete" },
    artifact_ref: "draft-v1"
  });

  status = service.statusGet({ mission_id: mission.id });
  assert.equal(status.summary.trace_count, 1, "trace_count reflects recorded trace");
  assert.equal(status.summary.evidence_count, 1, "evidence_count reflects recorded evidence");
});

test("activationList({ run_id }) returns only activations for that run", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const planId = service.planList({ mission_id: mission.id }).plans[0].id;

  const run1 = (await service.runCreate({ mission_id: mission.id, plan_ids: [planId] })).run;
  const run2 = (await service.runCreate({ mission_id: mission.id, plan_ids: [planId] })).run;

  // Each run should have activations from its own plan execution.
  const all = service.activationList({ mission_id: mission.id }).activations;
  assert.ok(all.length >= 2, "both runs created activations");

  // Filter by run_id using the SQL branch.
  const forRun1 = service.activationList({ run_id: run1.id }).activations;
  const forRun2 = service.activationList({ run_id: run2.id }).activations;

  assert.ok(forRun1.length > 0, "run1 has activations");
  assert.ok(forRun2.length > 0, "run2 has activations");
  assert.ok(
    forRun1.every((a) => a.run_id === run1.id),
    "all run1 activations belong to run1"
  );
  assert.ok(
    forRun2.every((a) => a.run_id === run2.id),
    "all run2 activations belong to run2"
  );
  assert.deepEqual(
    new Set([...forRun1.map((a) => a.id), ...forRun2.map((a) => a.id)]),
    new Set(all.map((a) => a.id)),
    "run1+run2 activations together equal mission activations"
  );
});

test("reviewList({ run_id }) returns only reviews for that run", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const planId = service.planList({ mission_id: mission.id }).plans[0].id;

  const run1 = (await service.runCreate({ mission_id: mission.id, plan_ids: [planId] })).run;
  const run2 = (await service.runCreate({ mission_id: mission.id, plan_ids: [planId] })).run;

  // Record one review per run.
  // Record one additional review per run on top of workflow-generated reviews.
  service.reviewRecord({
    mission_id: mission.id,
    run_id: run1.id,
    task_id: "",
    review_type: "spec",
    subject_ref: "plan-v1-extra",
    verdict: ReviewVerdict.PASS,
    blocking_issues: []
  });
  service.reviewRecord({
    mission_id: mission.id,
    run_id: run2.id,
    task_id: "",
    review_type: "quality",
    subject_ref: "plan-v1-extra",
    verdict: ReviewVerdict.PASS,
    blocking_issues: []
  });

  // run_id-only SQL branch.
  const forRun1 = service.reviewList({ run_id: run1.id }).reviews;
  const forRun2 = service.reviewList({ run_id: run2.id }).reviews;

  assert.ok(forRun1.length > 0, "run1 has reviews");
  assert.ok(forRun2.length > 0, "run2 has reviews");
  assert.ok(
    forRun1.every((r) => r.run_id === run1.id),
    "all run1 reviews belong to run1"
  );
  assert.ok(
    forRun2.every((r) => r.run_id === run2.id),
    "all run2 reviews belong to run2"
  );
  // No cross-contamination: run1 reviews should not appear in run2 results.
  const run1Ids = new Set(forRun1.map((r) => r.id));
  const run2Ids = new Set(forRun2.map((r) => r.id));
  assert.equal(run1Ids.size + run2Ids.size, run1Ids.size + run2Ids.size);
  assert.ok([...run1Ids].every((id) => !run2Ids.has(id)), "no cross-contamination between runs");

  // mission_id branch still works and returns all reviews.
  const forMission = service.reviewList({ mission_id: mission.id }).reviews;
  assert.equal(forMission.length, forRun1.length + forRun2.length, "mission filter returns sum of both runs");
});

test("ROI evidenceRecord rejects roi:go verification pass without implementation proof", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);

  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
        type: "verification",
        source: "roi:go",
        result: "pass",
        content: { implementation_proof: { oracles_ok: false } }
      }),
    /oracles_ok/
  );
});

test("ROI status_get leads with roi:go when plan verification failed", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Hub smoke",
      actions: ["add hub tests"],
      verification_targets: ["go test -run Hub"]
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "fail",
    content: { plan_id: plan.id, summary: "hub smoke missing" }
  });

  const { summary } = service.statusGet({ mission_id: mission.id });
  assert.equal(summary.next_actions[0], "roi:go");
});

test("ROI run_create mode=agent pauses with host handoff (non-stub execution_output)", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];

  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "agent",
    prompt: "Implement in product repo via roi:go"
  });

  assert.equal(runResult.status, "paused");
  assert.equal(runResult.run.status, RunStatus.PAUSED);
  assert.ok(runResult.next_actions.includes("roi:go"));

  const tasks = service.taskList({ run_id: runResult.run.id }).tasks;
  const implement = tasks.find((task) => task.payload.stage_kind === StageKind.IMPLEMENT);
  assert.equal(implement.status, TaskStatus.INPUT_REQUIRED);
  assert.equal(implement.blocking_reason, "awaiting_host_implementation");

  const evidence = service.evidenceList({ mission_id: mission.id, run_id: runResult.run.id }).evidence.find(
    (item) => item.type === "execution_output"
  );
  assert.ok(evidence);
  assert.equal(isLocalImplementStubOutput(evidence.content?.output), false);
  assert.equal(isHostImplementHandoffOutput(evidence.content?.output), true);

  const specReviews = service.reviewList({ run_id: runResult.run.id }).reviews.filter(
    (review) => review.review_type === StageKind.SPEC_REVIEW
  );
  assert.equal(specReviews.length, 0);
});

test("ROI run_resume completes agent implement after substantive roi:go", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];

  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "agent",
    prompt: "host handoff"
  });

  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"],
        oracles_run: [{ cmd: plan.verification_targets?.[0] ?? "go test ./...", ok: true }]
      }
    }
  });

  const resumed = await service.runResume({ run_id: runResult.run.id });
  assert.equal(resumed.status, "paused");
  assert.equal(resumed.task.payload.stage_kind, StageKind.VERIFY_GATE);

  const implement = service.taskList({ run_id: runResult.run.id }).tasks.find(
    (task) => task.payload.stage_kind === StageKind.IMPLEMENT
  );
  assert.equal(implement.status, TaskStatus.COMPLETED);

  const completionEvidence = service.evidenceList({ mission_id: mission.id, run_id: runResult.run.id }).evidence.filter(
    (item) => item.type === "execution_output"
  );
  assert.ok(completionEvidence.some((item) => String(item.content?.output ?? "").startsWith("HOST_IMPLEMENT_COMPLETED")));
  assert.ok(
    completionEvidence.every((item) => !isLocalImplementStubOutput(item.content?.output))
  );
});

test("ROI run_resume advances spec_review when substantive roi:go exists", async (t) => {
  const prevStub = process.env.ROI_ALLOW_LOCAL_STUB;
  delete process.env.ROI_ALLOW_LOCAL_STUB;
  t.after(() => {
    if (prevStub === undefined) {
      delete process.env.ROI_ALLOW_LOCAL_STUB;
    } else {
      process.env.ROI_ALLOW_LOCAL_STUB = prevStub;
    }
  });

  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];

  const runResult = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "stub only"
  });

  assert.equal(runResult.task.payload.stage_kind, StageKind.SPEC_REVIEW);
  const specReview = service.reviewList({ run_id: runResult.run.id }).reviews.find(
    (review) => review.review_type === StageKind.SPEC_REVIEW
  );
  assert.equal(specReview.verdict, ReviewVerdict.FAIL);
  assert.ok(specReview.blocking_issues.includes("local_implement_stub_only"));

  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"],
        oracles_run: [{ cmd: plan.verification_targets?.[0] ?? "go test ./...", ok: true }]
      }
    }
  });

  const resumed = await service.runResume({ run_id: runResult.run.id });
  assert.equal(resumed.run.status, RunStatus.PAUSED);
  assert.equal(resumed.task.payload.stage_kind, StageKind.VERIFY_GATE);

  const specReviews = service.reviewList({ run_id: runResult.run.id }).reviews.filter(
    (review) => review.review_type === StageKind.SPEC_REVIEW
  );
  assert.equal(specReviews.length, 2);
  assert.equal(specReviews.at(-1).verdict, ReviewVerdict.PASS);
});

test("ROI status_get hides local stub blocker once substantive roi:go exists", async (t) => {
  const prevStub = process.env.ROI_ALLOW_LOCAL_STUB;
  delete process.env.ROI_ALLOW_LOCAL_STUB;
  t.after(() => {
    if (prevStub === undefined) {
      delete process.env.ROI_ALLOW_LOCAL_STUB;
    } else {
      process.env.ROI_ALLOW_LOCAL_STUB = prevStub;
    }
  });

  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];

  const runResult = await service.runCreate({
    mission_id: mission.id,
    mode: "local",
    prompt: "stub only"
  });
  const blocked = service.statusGet({ mission_id: mission.id }).summary;
  assert.ok(
    blocked.blocking_issues.some((issue) =>
      issue.blocking_issues.includes("local_implement_stub_only")
    )
  );

  service.evidenceRecord({
    mission_id: mission.id,
    run_id: runResult.run.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"],
        oracles_run: [{ cmd: plan.verification_targets?.[0] ?? "go test ./...", ok: true }]
      }
    }
  });

  const afterGo = service.statusGet({ mission_id: mission.id }).summary;
  assert.equal(afterGo.mission_go_progress.complete, true);
  assert.deepEqual(afterGo.blocking_issues, []);
  assert.ok(!afterGo.next_actions.includes("roi:go"));
});

test("ROI status_get exposes mission_go_progress", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "x | 1 +",
        oracles_run: [{ cmd: plan.verification_targets?.[0] ?? "go test ./...", ok: true }]
      }
    }
  });

  const { summary } = service.statusGet({ mission_id: mission.id });
  assert.equal(summary.mission_go_progress.total, 1);
  assert.equal(summary.mission_go_progress.substantive, 1);
  assert.equal(summary.mission_go_progress.complete, true);
  assert.equal(summary.implementation_proof_trust, "agent_claimed");
});

test("ROI verifyEvaluate pass blocked when mission needs roi:go", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Hub smoke",
      actions: ["add hub tests"],
      verification_targets: ["go test -run Hub"]
    }
  });
  const run = (
    await service.runCreate({
      mission_id: mission.id,
      mode: "local",
      prompt: "stub path"
    })
  ).run;

  assert.throws(
    () => service.verifyEvaluate({ run_id: run.id, verdict: VerifyVerdict.PASS, notes: "premature pass" }),
    /verify_evaluate\(pass\) blocked/
  );
});

test("ROI evidenceRecord rejects verify_only_plan when plan has actions", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];

  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
        type: "verification",
        source: "roi:go",
        result: "pass",
        content: {
          plan_id: plan.id,
          verify_only_plan: true,
          implementation_proof: { oracles_ok: true, diff_stat: "x | 1 +" }
        }
      }),
    /verify_only_plan/
  );
});

test("ROI plan revise invalidates prior roi:go pass for mission progress", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "x | 1 +",
        oracles_run: [{ cmd: plan.verification_targets?.[0] ?? "go test ./...", ok: true }]
      }
    }
  });
  service.planRevise({
    plan_id: plan.id,
    verification_targets: ["go test -run NewOracle"]
  });

  const { summary } = service.statusGet({ mission_id: mission.id });
  assert.equal(summary.mission_go_progress.complete, false);
  assert.equal(summary.next_actions[0], "roi:go");
});

test("ROI run_oracles without flag keeps agent_claimed trust", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Oracle trust",
      actions: ["implement"],
      verification_targets: ['node -e "process.exit(0)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"],
        oracles_run: [{ cmd: 'node -e "process.exit(0)"', ok: true }]
      }
    }
  });
  const { summary } = service.statusGet({ mission_id: mission.id });
  assert.equal(summary.implementation_proof_trust, "agent_claimed");
});

test("ROI run_oracles stamps mcp_verified when targets pass", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "MCP oracles",
      actions: ["implement"],
      verification_targets: ['node -e "process.exit(0)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const recorded = service.evidenceRecord({
    mission_id: mission.id,
    run_oracles: true,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: false,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"]
      }
    }
  });
  const proof = recorded.evidence.content.implementation_proof;
  assert.equal(proof.verified_by, IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED);
  assert.equal(proof.oracles_ok, true);
  assert.ok(proof.oracles_run.every((row) => row.ok === true));
  const { summary } = service.statusGet({ mission_id: mission.id });
  assert.equal(summary.implementation_proof_trust, "mcp_verified");
});

test("ROI run_oracles blocks pass when verification_targets fail", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Failing oracle",
      actions: ["implement"],
      verification_targets: ['node -e "process.exit(3)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
        run_oracles: true,
        type: "verification",
        source: "roi:go",
        result: "pass",
        content: {
          plan_id: plan.id,
          implementation_proof: {
            oracles_ok: true,
            diff_stat: "bmo/go.mod | 0 +0",
            paths_touched: ["bmo/go.mod"]
          }
        }
      }),
    /run_oracles failed/
  );
});

test("ROI paths_touched rejects path outside workspace root", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
        type: "verification",
        source: "roi:go",
        result: "pass",
        content: {
          plan_id: plan.id,
          implementation_proof: {
            oracles_ok: true,
            diff_stat: "x",
            paths_touched: ["internal/foo.go"],
            oracles_run: [{ cmd: plan.verification_targets?.[0] ?? "t", ok: true }]
          }
        }
      }),
    /not found on disk/
  );
});

test("ROI verifyEvaluate require_verified_proof blocks agent_claimed go", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Verify gate",
      actions: ["implement"],
      verification_targets: ['node -e "process.exit(0)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const run = (
    await service.runCreate({
      mission_id: mission.id,
      mode: "local",
      prompt: "stub"
    })
  ).run;
  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"],
        oracles_run: [{ cmd: 'node -e "process.exit(0)"', ok: true }]
      }
    }
  });
  assert.throws(
    () =>
      service.verifyEvaluate({
        run_id: run.id,
        verdict: VerifyVerdict.PASS,
        notes: "needs mcp",
        require_verified_proof: true
      }),
    /require_verified_proof/
  );
});

test("ROI strict mission blocks agent_claimed roi:go pass", (t) => {
  const { service } = createHarness(t);
  const mission = service.missionCreate({
    title: "Strict maturity mission",
    goal: "Ax→5 stretch"
  }).mission;
  service.briefRevise({
    mission_id: mission.id,
    constraints: ["verification_policy: strict"]
  });
  service.planGenerate({
    mission_id: mission.id,
    plans: [
      {
        name: "U1",
        actions: ["implement"],
        verification_targets: ['node -e "process.exit(0)"']
      }
    ]
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
        type: "verification",
        source: "roi:go",
        result: "pass",
        content: {
          plan_id: plan.id,
          implementation_proof: {
            oracles_ok: true,
            diff_stat: "bmo/go.mod | 1 +1",
            paths_touched: ["bmo/go.mod"],
            oracles_run: [{ cmd: 'node -e "process.exit(0)"', ok: true }]
          }
        }
      }),
    /verification_policy is strict/
  );
});

test("ROI strict mission auto require_verified_proof at verify gate", async (t) => {
  const { service } = createHarness(t);
  const mission = service.missionCreate({
    title: "Strict verify",
    goal: "graduation"
  }).mission;
  service.briefRevise({
    mission_id: mission.id,
    constraints: ["graduation_mode: A-grade"]
  });
  service.planGenerate({
    mission_id: mission.id,
    plans: [
      {
        name: "Gate plan",
        actions: ["implement"],
        verification_targets: ['node -e "process.exit(0)"']
      }
    ]
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const run = (
    await service.runCreate({
      mission_id: mission.id,
      mode: "local",
      prompt: "stub"
    })
  ).run;
  assert.throws(
    () =>
      service.evidenceRecord({
        mission_id: mission.id,
        type: "verification",
        source: "roi:go",
        result: "pass",
        content: {
          plan_id: plan.id,
          implementation_proof: {
            oracles_ok: true,
            diff_stat: "bmo/go.mod | 0 +0",
            paths_touched: ["bmo/go.mod"],
            oracles_run: [{ cmd: 'node -e "process.exit(0)"', ok: true }]
          }
        }
      }),
    /verification_policy is strict/
  );
  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    run_oracles: true,
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"]
      }
    }
  });
  const { summary } = service.statusGet({ mission_id: mission.id });
  assert.equal(summary.verification_policy, "strict");
  assert.equal(summary.requires_helper_verified_proof, true);
  assert.equal(summary.mission_go_progress.complete, true);
  const verdict = service.verifyEvaluate({
    run_id: run.id,
    verdict: VerifyVerdict.PASS,
    notes: "strict mission with helper-verified roi:go"
  });
  assert.equal(verdict.evidence.result, VerifyVerdict.PASS);
});

test("ROI quality_review reopen invalidates substantive go progress", (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  service.evidenceRecord({
    mission_id: mission.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/x | 1 +1",
        oracles_run: [{ cmd: "go test", ok: true }]
      }
    }
  });
  assert.equal(service.statusGet({ mission_id: mission.id }).summary.mission_go_progress.complete, true);
  service.evidenceRecord({
    mission_id: mission.id,
    type: "quality_review",
    source: "holistic-review-remediator",
    result: "reopen",
    content: {
      plan_ids: [plan.id],
      summary: "post-ship review gap"
    }
  });
  const after = service.statusGet({ mission_id: mission.id }).summary;
  assert.equal(after.mission_go_progress.complete, false);
  assert.equal(after.next_actions[0], "roi:go");
});

test("ROI verifyEvaluate require_verified_proof allows mcp_verified go", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "MCP verify gate",
      actions: ["implement"],
      verification_targets: ['node -e "process.exit(0)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const run = (
    await service.runCreate({
      mission_id: mission.id,
      mode: "local",
      prompt: "stub"
    })
  ).run;
  service.evidenceRecord({
    mission_id: mission.id,
    run_oracles: true,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"]
      }
    }
  });
  const verified = service.verifyEvaluate({
    run_id: run.id,
    verdict: VerifyVerdict.PASS,
    notes: "mcp verified",
    require_verified_proof: true
  });
  assert.equal(verified.verdict, VerifyVerdict.PASS);
});

test("ROI verifyEvaluate run_oracles stamps verify_gate on pass", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Verify gate oracles",
      actions: ["implement"],
      verification_targets: ['node -e "process.exit(0)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "local",
    prompt: "stub"
  });
  recordSubstantiveRoiGoForRun(service, mission.id, runResult.run);

  const verified = service.verifyEvaluate({
    run_id: runResult.run.id,
    verdict: VerifyVerdict.PASS,
    notes: "gate oracles green",
    run_oracles: true
  });

  assert.equal(verified.run.status, RunStatus.COMPLETED);
  const gateEvidence = service.evidenceList({ mission_id: mission.id, run_id: runResult.run.id }).evidence.find(
    (item) => item.source === "verify.evaluate" && item.type === "verification"
  );
  assert.ok(gateEvidence);
  assert.equal(gateEvidence.content.verify_gate.verified_by, IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED);
  assert.equal(gateEvidence.content.verify_gate.oracles_ok, true);
  assert.ok(gateEvidence.content.verify_gate.oracles_run.every((row) => row.ok === true));
});

test("ROI verifyEvaluate run_oracles blocks pass when targets fail", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service, {
    plan: {
      name: "Failing verify gate",
      actions: ["implement"],
      verification_targets: ['node -e "process.exit(4)"']
    }
  });
  const plan = service.planList({ mission_id: mission.id }).plans[0];
  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: [plan.id],
    mode: "local",
    prompt: "stub"
  });
  recordSubstantiveRoiGoForRun(service, mission.id, runResult.run);

  assert.throws(
    () =>
      service.verifyEvaluate({
        run_id: runResult.run.id,
        verdict: VerifyVerdict.PASS,
        run_oracles: true
      }),
    /run_oracles failed/
  );
});

test("ROI verifyEvaluate allow_partial checkpoint pass when one plan substantive", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  service.planGenerate({
    mission_id: mission.id,
    plans: [
      {
        name: "Plan A",
        actions: ["implement a"],
        verification_targets: ['node -e "process.exit(0)"']
      },
      {
        name: "Plan B",
        actions: ["implement b"],
        verification_targets: ['node -e "process.exit(0)"']
      }
    ]
  });
  const plans = service.planList({ mission_id: mission.id }).plans;
  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: plans.map((plan) => plan.id),
    mode: "local",
    prompt: "stub"
  });
  recordSubstantiveRoiGo(service, mission.id, plans[0]);

  const verified = service.verifyEvaluate({
    run_id: runResult.run.id,
    verdict: VerifyVerdict.PASS,
    allow_partial_verification: true,
    notes: "wave 1 checkpoint"
  });

  assert.equal(verified.run.status, RunStatus.PAUSED);
  assert.ok(verified.next_actions.includes("roi:go"));
  assert.ok(!verified.next_actions.includes("roi:publish"));
  assert.equal(verified.partial_verification_checkpoint, true);
  const gateEvidence = service.evidenceList({ mission_id: mission.id, run_id: runResult.run.id }).evidence.find(
    (item) => item.source === "verify.evaluate"
  );
  assert.equal(gateEvidence.content.verify_gate.partial_mission, true);
  assert.ok(gateEvidence.content.verify_gate.open_count >= 1);
  assert.ok(gateEvidence.content.verify_gate.substantive_count >= 1);
});

test("ROI verifyEvaluate partial pass leaves non-substantive plan verify task open", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  service.planGenerate({
    mission_id: mission.id,
    plans: [
      { name: "Plan A", actions: ["implement a"], verification_targets: ['node -e "process.exit(0)"'] },
      { name: "Plan B", actions: ["implement b"], verification_targets: ['node -e "process.exit(0)"'] }
    ]
  });
  const plans = service.planList({ mission_id: mission.id }).plans;
  const runResult = await service.runCreate({
    mission_id: mission.id,
    plan_ids: plans.map((plan) => plan.id),
    mode: "local",
    prompt: "stub"
  });
  // Only Plan A gets substantive roi:go evidence.
  recordSubstantiveRoiGo(service, mission.id, plans[0]);

  service.verifyEvaluate({
    run_id: runResult.run.id,
    verdict: VerifyVerdict.PASS,
    allow_partial_verification: true,
    notes: "wave 1 checkpoint"
  });

  const tasks = service.taskList({ run_id: runResult.run.id }).tasks;
  const verifyTaskFor = (planId) =>
    tasks.find(
      (task) => task.payload?.stage_kind === StageKind.VERIFY_GATE && task.plan_id === planId
    );
  const planAVerify = verifyTaskFor(plans[0].id);
  const planBVerify = verifyTaskFor(plans[1].id);

  // Plan A (substantive) may complete; Plan B (still owes roi:go) must NOT be
  // closed by the partial pass — otherwise its verify gate is bypassed.
  assert.equal(planAVerify.status, TaskStatus.COMPLETED);
  assert.notEqual(
    planBVerify.status,
    TaskStatus.COMPLETED,
    "non-substantive plan's verify gate must remain open after a partial pass"
  );
});

test("ROI verifyEvaluate allow_partial rejects verdict partial", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const run = (await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" })).run;
  assert.throws(
    () =>
      service.verifyEvaluate({
        run_id: run.id,
        verdict: VerifyVerdict.PARTIAL,
        allow_partial_verification: true
      }),
    /only supported with verdict pass/
  );
});

test("ROI verifyEvaluate allow_partial blocked with zero substantive go", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const run = (await service.runCreate({ mission_id: mission.id, mode: "local", prompt: "stub" })).run;
  assert.throws(
    () =>
      service.verifyEvaluate({
        run_id: run.id,
        verdict: VerifyVerdict.PASS,
        allow_partial_verification: true
      }),
    /at least one substantive/
  );
});

test("ROI status_get exposes partial_verification_eligible", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  service.planGenerate({
    mission_id: mission.id,
    plans: [
      { name: "P1", actions: ["a"], verification_targets: ["t"] },
      { name: "P2", actions: ["b"], verification_targets: ["u"] }
    ]
  });
  const plans = service.planList({ mission_id: mission.id }).plans;
  recordSubstantiveRoiGo(service, mission.id, plans[0]);
  const status = service.statusGet({ mission_id: mission.id });
  const hint = status.summary.partial_verification_eligible;
  assert.equal(hint.eligible, true);
  assert.ok(hint.substantive_count >= 1);
  assert.ok(hint.open_count >= 1);
  assert.equal(hint.mission_complete, false);
});

test("ROI verifyEvaluate non-pass next_actions include roi:go", async (t) => {
  const { service } = createHarness(t);
  const mission = seedMission(service);
  const run = (
    await service.runCreate({
      mission_id: mission.id,
      mode: "local",
      prompt: "stub path"
    })
  ).run;

  const partial = service.verifyEvaluate({
    run_id: run.id,
    verdict: VerifyVerdict.PARTIAL,
    notes: "U2 hub smoke tests missing"
  });

  assert.ok(partial.next_actions.includes("roi:go"));
});

class TestA2AAgentExecutor {
  async execute(requestContext, eventBus) {
    const taskId = requestContext.taskId || `task-${crypto.randomUUID()}`;
    eventBus.publish({
      kind: "message",
      messageId: crypto.randomUUID(),
      taskId,
      contextId: requestContext.contextId,
      role: "agent",
      parts: [
        {
          kind: "text",
          text: "Remote task complete"
        }
      ]
    });
    eventBus.finished();
  }

  cancelTask = async () => {};
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
