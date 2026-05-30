import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTestService } from "./_helper-test-driver.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("ROI editorial loop dogfoods review edit publish learn inspect via lifecycle helper", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-editorial-loop-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const harness = createTestService(path.join(tmpDir, "editorial-loop.sqlite"));
  t.after(() => {
    try {
      harness.db.close();
    } catch {
      // ignore
    }
  });

  const roi = createEditorialClient(harness);

  const worked = await roi.work({
    title: "Dogfood the ROI editorial loop",
    goal: "Exercise the editorial ROI lifecycle in-process and confirm the published path advances cleanly into learning.",
    owner: "roi-test",
    audience: "plugin operator"
  });
  assert.deepEqual(worked.next_actions, ["roi:brief"]);
  const missionId = worked.mission.id;

  const briefed = await roi.brief(missionId, {
    constraints: [
      "Stay self-contained inside roi/",
      "Drive the editorial layer through the lifecycle helper, not over MCP"
    ],
    success_criteria: [
      "A failed draft can route into roi:edit",
      "A published run stops suggesting roi:publish",
      "Three successful published runs unlock roi:learn"
    ],
    non_goals: [
      "No backend schema migration",
      "No remote A2A setup for this dogfood pass"
    ],
    assumptions: [
      "Local execution is sufficient for the editorial regression",
      "Publication is represented by durable evidence on the completed run"
    ]
  });
  assert.deepEqual(briefed.next_actions, ["roi:source", "roi:outline"]);

  const sourced = await roi.source(missionId, {
    question: "What makes the editorial loop feel complete to an operator?",
    sources: [
      "roi/docs/command-reference.md",
      "roi/docs/quickstart.md"
    ],
    findings: [
      "review should lead into edit or publish",
      "publish should create a durable handoff boundary",
      "inspect should present the next operator move clearly"
    ],
    tradeoffs: [
      "publish is a compound client-side flow over evidence.record"
    ],
    recommendation: "Use in-process integration coverage to prove the editorial story end to end.",
    confidence: 0.86
  });
  assert.deepEqual(sourced.next_actions, ["roi:outline"]);

  const outlined = await roi.outline(missionId, {
    plans: [
      {
        name: "Exercise editorial lifecycle",
        scope: "Walk one mission through review, edit, publish, learn, and inspect",
        actions: [
          "Create a draft with a deliberate review failure",
          "Revise the outline after review feedback",
          "Produce three successful published runs",
          "Run learning and inspect the resulting next actions"
        ],
        verification_targets: [
          "A failing review suggests roi:edit",
          "A successful review suggests roi:publish",
          "After publication inspect suggests roi:learn instead of roi:publish",
          "After learning inspect suggests capability.promote"
        ],
        wave: 1
      }
    ]
  });
  assert.deepEqual(outlined.next_actions, ["roi:draft"]);
  const planId = outlined.plans[0].id;

  const failedDraft = await roi.draft(missionId, {
    plan_ids: [planId],
    mode: "local",
    prompt: "Draft the loop summary with an UNVERIFIED_COMPLETION_CLAIM before review evidence exists."
  });
  assert.equal(failedDraft.status, "paused");
  assert.deepEqual(failedDraft.next_actions, ["roi:go", "roi:edit", "roi:inspect"]);

  const blockedState = await roi.inspect(missionId);
  assert.deepEqual(blockedState.summary.next_actions, ["roi:go", "roi:edit", "roi:inspect"]);
  assert.ok(
    blockedState.summary.blocking_issues.some((issue) =>
      issue.blocking_issues.includes("unverified_completion_claim") ||
      issue.blocking_issues.includes("verification_evidence_missing_before_completion_claim")
    )
  );

  const edited = await roi.edit(missionId, planId, {
    actions: [
      "Remove unsupported completion claims",
      "Carry review targets forward into the draft",
      "Publish only after review passes"
    ],
    verification_targets: [
      "No unverified completion claim remains in execution output",
      "Publish is no longer suggested after publication",
      "Learning becomes eligible after three successful runs"
    ],
    prompt: "Produce an evidence-backed draft that is ready for review."
  });
  assert.equal(edited.revised_plan.plan.id, planId);
  assert.equal(edited.redraft.status, "paused");
  assert.deepEqual(edited.redraft.next_actions, ["roi:review"]);

  const firstReviewed = await roi.review(missionId, edited.redraft.run.id, {
    verdict: "pass",
    notes: "Editorial path is ready for publication."
  });
  assert.ok(firstReviewed.before.summary.next_actions.includes("roi:review"));
  assert.ok(firstReviewed.history.reviews.length >= 2);
  assert.deepEqual(firstReviewed.result.next_actions, ["roi:publish", "roi:learn"]);

  const firstPublished = await roi.publish(missionId, edited.redraft.run.id, {
    artifact_ref: "docs/editorial-loop-dogfood.md",
    result: "Published the reviewed editorial walkthrough",
    content: { channel: "dogfood-test", iteration: 1 }
  });
  assert.equal(firstPublished.recorded.status, "ok");

  const afterFirstPublish = await roi.inspect(missionId);
  assert.deepEqual(afterFirstPublish.summary.next_actions, ["roi:learn", "roi:inspect"]);

  for (const [index, prompt] of [
    "Second evidence-backed draft for the same plan.",
    "Third evidence-backed draft for the same plan."
  ].entries()) {
    const drafted = await roi.draft(missionId, {
      plan_ids: [planId],
      mode: "local",
      prompt
    });
    assert.equal(drafted.status, "paused");
    assert.deepEqual(drafted.next_actions, ["roi:review"]);

    const reviewed = await roi.review(missionId, drafted.run.id, {
      verdict: "pass",
      notes: `Published pass ${index + 2}`
    });
    assert.deepEqual(reviewed.result.next_actions, ["roi:publish", "roi:learn"]);

    const published = await roi.publish(missionId, drafted.run.id, {
      artifact_ref: `docs/editorial-loop-dogfood-${index + 2}.md`,
      result: `Published pass ${index + 2}`,
      content: { channel: "dogfood-test", iteration: index + 2 }
    });
    assert.equal(published.recorded.status, "ok");
  }

  const learned = await roi.learn(missionId);
  assert.equal(learned.status, "ok");
  assert.equal(learned.capabilities.length, 1);

  const finalState = await roi.inspect(missionId);
  assert.ok(
    finalState.summary.learning_readiness.some((entry) =>
      entry.successful_activations >= 3 && entry.eligible_for_promotion
    )
  );
  assert.equal(finalState.summary.capability_proposals.length, 1);
  assert.deepEqual(finalState.summary.next_actions, ["capability.promote", "roi:inspect"]);
});

function createEditorialClient(harness) {
  return {
    work(args) {
      return harness.call("mission_create", args);
    },
    brief(missionId, args) {
      return harness.call("brief_revise", { mission_id: missionId, ...args });
    },
    source(missionId, args) {
      return harness.call("research_record", { mission_id: missionId, ...args });
    },
    outline(missionId, args) {
      return harness.call("plan_generate", { mission_id: missionId, ...args });
    },
    draft(missionId, args) {
      return harness.call("run_create", { mission_id: missionId, ...args });
    },
    async review(missionId, runId, args) {
      const run = (await harness.call("run_get", { run_id: runId })).run;
      await recordSubstantiveRoiGoForRun(harness, missionId, run);
      return {
        before: await harness.call("status_get", { mission_id: missionId }),
        history: await harness.call("review_list", { run_id: runId }),
        result: await harness.call("verify_evaluate", { run_id: runId, ...args })
      };
    },
    async edit(missionId, planId, args) {
      return {
        before: await harness.call("status_get", { mission_id: missionId }),
        revised_plan: await harness.call("plan_revise", {
          plan_id: planId,
          actions: args.actions,
          verification_targets: args.verification_targets
        }),
        redraft: await harness.call("run_create", {
          mission_id: missionId,
          plan_ids: [planId],
          mode: "local",
          prompt: args.prompt
        })
      };
    },
    async publish(missionId, runId, args) {
      return {
        before: await harness.call("status_get", { mission_id: missionId }),
        recorded: await harness.call("evidence_record", {
          mission_id: missionId,
          run_id: runId,
          type: "publication",
          source: "editorial-loop.test",
          artifact_ref: args.artifact_ref,
          result: args.result,
          content: args.content
        }),
        after: await harness.call("status_get", { mission_id: missionId })
      };
    },
    learn(missionId) {
      return harness.call("enlighten_run", { mission_id: missionId });
    },
    inspect(missionId) {
      return harness.call("status_get", { mission_id: missionId });
    }
  };
}

async function recordSubstantiveRoiGoForRun(harness, missionId, run) {
  const plans = (await harness.call("plan_list", { mission_id: missionId })).plans ?? [];
  const planIds = new Set((run.plan_ids ?? []).map((id) => String(id)));
  for (const plan of plans) {
    if (planIds.size > 0 && !planIds.has(plan.id)) {
      continue;
    }
    const hasWork =
      (plan.actions?.length ?? 0) > 0 || (plan.verification_targets?.length ?? 0) > 0;
    if (!hasWork) {
      continue;
    }
    await harness.call("evidence_record", {
      mission_id: missionId,
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
  }
}
