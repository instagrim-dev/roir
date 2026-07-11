import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VERB_TO_METHOD } from "../scripts/lifecycle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");
const helperPath = path.join(roiRoot, "scripts", "lifecycle.mjs");

/**
 * Contract tests for `scripts/lifecycle.mjs` invoked as a subprocess.
 *
 * The fast in-process driver in `_helper-test-driver.mjs` covers most
 * lifecycle behavior, but argument parsing, exit semantics, stderr
 * formatting, and JSON serialization are properties of the helper as a
 * **subprocess**, not of ROIService directly. This file exercises the
 * critical editorial/convergence verbs through the helper end-to-end so
 * helper-level regressions cannot slip through with in-process tests
 * still passing.
 */

function runHelper(args, options = {}) {
  return spawnSync(process.execPath, [helperPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input,
  });
}

function callVerb(dbPath, verb, args = {}) {
  const result = runHelper([verb, JSON.stringify(args)], {
    env: { ROI_SQLITE_PATH: dbPath },
  });
  if (result.status !== 0) {
    throw new Error(
      `lifecycle helper '${verb}' failed (exit ${result.status}): ${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

test("lifecycle helper exposes the canonical verb registry", () => {
  const result = runHelper(["--list-verbs"]);
  assert.equal(result.status, 0, `--list-verbs failed: ${result.stderr}`);
  const live = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const expected = [...VERB_TO_METHOD.keys()];
  assert.deepEqual(
    [...live].sort(),
    [...expected].sort(),
    "live --list-verbs output drifted from exported VERBS registry"
  );
});

test("lifecycle helper preserves the documented legacy single-plan selector", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-helper-single-plan-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const dbPath = path.join(tmpDir, "single-plan.sqlite");
  const mission = callVerb(dbPath, "mission_create", {
    title: "Single-plan helper contract",
    goal: "Do not broaden a documented one-plan run"
  }).mission;
  callVerb(dbPath, "brief_revise", {
    mission_id: mission.id,
    success_criteria: ["The selected plan remains the only run member"]
  });
  const plans = callVerb(dbPath, "plan_generate", {
    mission_id: mission.id,
    plans: ["A", "B"].map((name) => ({
      name: `Plan ${name}`,
      actions: [`implement ${name}`],
      verification_targets: [`${name} passes`],
      planning_orientation: planningOrientation(`Plan ${name}`, `${name} passes`)
    }))
  }).plans;

  const run = callVerb(dbPath, "run_create", {
    mission_id: mission.id,
    plan_id: plans[0].id,
    mode: "local"
  }).run;
  assert.deepEqual(run.plan_ids, [plans[0].id]);
  assert.deepEqual(run.plan_refs, [{ plan_id: plans[0].id, plan_revision: 1 }]);
});

test("lifecycle helper drives editorial-loop critical path end to end", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-helper-contract-edit-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const dbPath = path.join(tmpDir, "editorial.sqlite");

  const worked = callVerb(dbPath, "mission_create", {
    title: "Helper contract editorial",
    goal: "Drive editorial verbs through the lifecycle helper subprocess.",
    owner: "roi-test",
    audience: "plugin operator",
  });
  const missionId = worked.mission.id;
  assert.ok(missionId, "mission_create did not return mission.id");

  callVerb(dbPath, "brief_revise", {
    mission_id: missionId,
    success_criteria: [
      "Helper subprocess can drive a full editorial pass",
      "verify_evaluate verdicts persist across helper invocations",
    ],
  });

  const planResp = callVerb(dbPath, "plan_generate", {
    mission_id: missionId,
    plans: [
      {
        name: "Editorial seam",
        scope: "Exercise the helper end-to-end",
        actions: ["Stamp helper-driven evidence"],
        verification_targets: ["Helper round-trip persists state"],
        planning_orientation: planningOrientation(
          "Editorial seam",
          "Helper round-trip persists state"
        ),
      },
    ],
  });
  assert.ok(planResp.plans?.length, "plan_generate did not return plans");

  const drafted = callVerb(dbPath, "run_create", {
    mission_id: missionId,
    mode: "local",
    prompt: "Drive the editorial seam through the helper subprocess",
  });
  assert.equal(drafted.status, "paused", "run_create should pause at verify_gate");

  refreshImplementationOrientation(dbPath, missionId, planResp.plans[0], drafted.run.id, drafted.task.id);
  refreshVerificationOrientation(dbPath, missionId, planResp.plans[0], drafted.run.id, drafted.task.id);

  callVerb(dbPath, "evidence_record", {
    mission_id: missionId,
    run_id: drafted.run.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: planResp.plans[0].id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "bmo/go.mod | 0 +0",
        paths_touched: ["bmo/go.mod"],
        oracles_run: [
          { cmd: "Helper round-trip persists state", ok: true },
        ],
      },
    },
  });

  refreshRunVerifierOrientations(dbPath, missionId, planResp.plans[0], drafted.run.id);

  const verdict = callVerb(dbPath, "verify_evaluate", {
    run_id: drafted.run.id,
    verdict: "pass",
    notes: "Helper-driven editorial pass",
  });
  assert.equal(verdict.verdict, "pass");

  const status = callVerb(dbPath, "status_get", { mission_id: missionId });
  assert.ok(
    Array.isArray(status.summary?.next_actions),
    "status_get missing next_actions"
  );
});

test("lifecycle helper rejects unknown verbs with non-zero exit and stderr", () => {
  const result = runHelper(["definitely_not_a_verb", "{}"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lifecycle: unknown verb/);
});

test("lifecycle helper rejects malformed JSON with non-zero exit", () => {
  const result = runHelper(["mission_list", "{not-json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lifecycle: invalid JSON/);
});

test("lifecycle helper surfaces service-thrown errors on stderr", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-helper-contract-err-"));
  try {
    const result = runHelper(["verify_evaluate", "{}"], {
      env: { ROI_SQLITE_PATH: path.join(tmpDir, "err.sqlite") },
    });
    assert.equal(result.status, 1, "verify_evaluate with empty args must fail");
    assert.match(result.stderr, /lifecycle: verify_evaluate failed:/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("lifecycle helper validates args against ToolSchemas before dispatch", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-helper-contract-val-"));
  try {
    const dbPath = path.join(tmpDir, "val.sqlite");
    // mission_id must be a string; a number is a contract violation that should
    // be rejected at the dispatch boundary, not coerced into business logic.
    const result = runHelper(["mission_get", JSON.stringify({ mission_id: 123 })], {
      env: { ROI_SQLITE_PATH: dbPath },
    });
    assert.equal(result.status, 1, "type-invalid args must be rejected");
    assert.match(result.stderr, /invalid arguments/);
    assert.match(result.stderr, /mission_id/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("lifecycle helper accepts independent source-contract verify gate", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-helper-source-contract-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const dbPath = path.join(tmpDir, "source-contract.sqlite");

  const mission = callVerb(dbPath, "mission_create", {
    title: "Helper source-contract gate",
    goal: "Verify independent source-contract review through the helper.",
  }).mission;
  callVerb(dbPath, "brief_revise", {
    mission_id: mission.id,
    success_criteria: ["Source-contract review is independently checked"],
  });
  const plan = callVerb(dbPath, "plan_generate", {
    mission_id: mission.id,
    plans: [
      {
        name: "Source-contract helper seam",
        actions: ["Record reviewed evidence"],
        verification_targets: ["node -e \"process.exit(0)\""],
        planning_orientation: planningOrientation(
          "Source-contract helper seam",
          "node -e \"process.exit(0)\""
        ),
        source_contract_refs: ["docs/plans/source-roadmap.md"],
        requires_source_contract_check: true,
      },
    ],
  }).plans[0];
  const run = callVerb(dbPath, "run_create", {
    mission_id: mission.id,
    mode: "local",
    prompt: "Drive source-contract helper gate",
  }).run;
  refreshImplementationOrientation(dbPath, mission.id, plan, run.id, run.task_refs?.[0]);
  refreshVerificationOrientation(dbPath, mission.id, plan, run.id, run.task_refs?.[0]);
  callVerb(dbPath, "evidence_record", {
    mission_id: mission.id,
    run_id: run.id,
    type: "verification",
    source: "roi:go",
    result: "pass",
    content: {
      plan_id: plan.id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "roi/src/service.mjs | 1 +",
        paths_touched: ["roi/src/service.mjs"],
        oracles_run: [{ cmd: plan.verification_targets[0], ok: true }],
        source_contract: {
          source_refs: ["docs/plans/source-roadmap.md"],
          review: {
            mode: "independent",
            reviewer: "helper-contract-test",
            evidence: "artifact-independent-review-123",
          },
          coverage: [
            {
              requirement: "Source-contract review is independently checked",
              disposition: "verification_target",
              verification_target: plan.verification_targets[0],
            },
          ],
        },
      },
    },
  });
  refreshRunVerifierOrientations(dbPath, mission.id, plan, run.id);
  const verdict = callVerb(dbPath, "verify_evaluate", {
    run_id: run.id,
    verdict: "pass",
    notes: "independent source-contract review present",
    require_independent_source_contract_review: true,
  });
  assert.equal(verdict.verdict, "pass");
  assert.equal(verdict.evidence.content.source_contract_proof_confidence, "independent_reviewed");
});

function planningOrientation(owner, verificationTarget) {
  return {
    status: "current",
    workspace_root: "roi-helper-test",
    instruction_sources: ["roi/AGENTS.md"],
    source_artifacts: ["helper contract fixture"],
    live_state_identity: "fixture:planning-current",
    authority_constraints: ["fixture scope only"],
    owner_seams: [{
      id: "OS1",
      owner,
      seam: "helper lifecycle seam",
      evidence_sources: ["helper contract fixture"]
    }],
    material_uncertainties: [],
    proof_obligations: [{
      id: "PO1",
      obligation: verificationTarget,
      owner_seam_ids: ["OS1"],
      verification_targets: [verificationTarget]
    }],
    execution_preconditions: ["plan revision is current"],
    completion_basis: "owner_seam_coverage_and_material_uncertainty"
  };
}

function refreshVerificationOrientation(dbPath, missionId, plan, runId = "", taskId) {
  const targetBundle = plan.verification_targets.join("\n");
  return callVerb(dbPath, "orientation_refresh", {
    mission_id: missionId,
    plan_id: plan.id,
    plan_revision: plan.revision,
    run_id: runId,
    task_id: taskId,
    plan_identity: `${plan.id}@${plan.revision}`,
    live_state_identity: `fixture:verify:${runId || "plan"}`,
    current_unit: targetBundle,
    next_action: targetBundle,
    action_class: "verifier_execution",
    proof_obligation_ids: plan.planning_orientation.proof_obligations.map((item) => item.id),
    proof_targets: plan.verification_targets,
    checked_preconditions: ["plan revision and targets are current"],
    observed_owner_seam_ids: plan.planning_orientation.owner_seams.map((item) => item.id),
    reason: "pre_mutation"
  });
}

function refreshImplementationOrientation(dbPath, missionId, plan, runId = "", taskId) {
  const actionBundle = plan.actions.join("\n");
  return callVerb(dbPath, "orientation_refresh", {
    mission_id: missionId,
    plan_id: plan.id,
    plan_revision: plan.revision,
    run_id: runId,
    task_id: taskId,
    plan_identity: `${plan.id}@${plan.revision}`,
    live_state_identity: `fixture:implement:${runId || "plan"}`,
    current_unit: actionBundle,
    next_action: actionBundle,
    action_class: "implementation",
    proof_obligation_ids: plan.planning_orientation.proof_obligations.map((item) => item.id),
    proof_targets: plan.verification_targets,
    checked_preconditions: ["plan revision and actions are current"],
    observed_owner_seam_ids: plan.planning_orientation.owner_seams.map((item) => item.id),
    reason: "pre_mutation"
  });
}

function refreshRunVerifierOrientations(dbPath, missionId, plan, runId) {
  const tasks = callVerb(dbPath, "task_list", { run_id: runId }).tasks.filter((task) =>
    task.plan_id === plan.id && ["spec_review", "quality_review", "verify_gate"].includes(task.payload?.stage_kind)
  );
  for (const task of tasks) {
    refreshVerificationOrientation(dbPath, missionId, plan, runId, task.id);
  }
}
