import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTestService } from "./_helper-test-driver.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("ROI convergence missions elect, publish, and re-elect seams via lifecycle helper", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-convergence-loop-"));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const harness = createTestService(path.join(tmpDir, "convergence-loop.sqlite"));
  t.after(() => {
    try {
      harness.db.close();
    } catch {
      // ignore
    }
  });

  const worked = await harness.call("mission_create", {
    title: "Converge mission control",
    goal: "Drive one seam at a time toward a declared maturity target.",
    convergence: {
      domain: "Mission Control",
      current_maturity: "drafted",
      target_maturity: "shipped",
      maturity_ladder: ["drafted", "reviewed", "shipped"],
      autonomy_mode: "auto_low_judgment"
    }
  });
  const missionId = worked.mission.id;

  await harness.call("brief_revise", {
    mission_id: missionId,
    success_criteria: [
      "An active seam is elected with inspectable rationale",
      "Publishing a seam re-elects the next seam"
    ]
  });

  await harness.call("plan_generate", {
    mission_id: missionId,
    seams: [
      {
        title: "Stabilize publish boundary",
        summary: "Make publish finalization durable",
        expected_maturity_gain: 2,
        advances_to: "reviewed",
        unlock_score: 1,
        evidence_confidence: 0.8,
        requires_judgment: false,
        plan: {
          actions: ["Finalize seam one"],
          verification_targets: ["Seam one publishes durably"]
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
          verification_targets: ["Seam two publishes durably"]
        }
      }
    ]
  });

  const beforeDraft = await harness.call("status_get", { mission_id: missionId });
  assert.equal(beforeDraft.summary.convergence.controller.state, "active");
  assert.equal(beforeDraft.summary.convergence.active_seam.title, "Stabilize publish boundary");
  assert.deepEqual(beforeDraft.summary.next_actions, ["roi:go", "roi:draft", "roi:inspect"]);

  const drafted = await harness.call("run_create", {
    mission_id: missionId,
    mode: "local",
    prompt: "Run the active convergence seam"
  });
  assert.equal(drafted.status, "paused");

  await recordSubstantiveRoiGoForRun(harness, missionId, drafted.run);
  await harness.call("verify_evaluate", {
    run_id: drafted.run.id,
    verdict: "pass",
    notes: "Ready to publish"
  });

  await harness.call("evidence_record", {
    mission_id: missionId,
    run_id: drafted.run.id,
    type: "publication",
    source: "convergence-loop.test",
    artifact_ref: "docs/seam-one.md",
    result: "Published seam one",
    content: {}
  });

  const afterPublish = await harness.call("status_get", { mission_id: missionId });
  assert.equal(afterPublish.summary.convergence.controller.current_maturity, "reviewed");
  assert.equal(afterPublish.summary.convergence.active_seam.title, "Ship remaining seam");
  assert.deepEqual(afterPublish.summary.next_actions, ["roi:go", "roi:draft", "roi:inspect"]);
});

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
