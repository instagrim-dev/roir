/**
 * Shared in-process driver for editorial-loop and convergence-loop tests.
 *
 * Calls ROIService directly in-process (no Node subprocess per call) but
 * sources its verb→method map from the canonical lifecycle helper registry
 * so the two cannot drift. Treat this driver as the **fast fixture** path: it
 * may complete orientation setup automatically for tests that are not
 * exercising the operator recovery path. The **contract** path is the
 * lifecycle helper itself, exercised explicitly by
 * `test/lifecycle-helper-contract.test.mjs` and `pnpm run smoke:integration`.
 *
 * If you find yourself adding a verb here, add it to
 * `scripts/lifecycle.mjs` (`VERBS`) instead — this driver picks it up
 * automatically.
 */

import { openDatabase } from "../src/db.mjs";
import { ROIService } from "../src/service.mjs";
import { VERB_TO_METHOD, dispatchVerb } from "../scripts/lifecycle.mjs";

export function createTestService(sqlitePath) {
  const db = openDatabase(sqlitePath);
  const service = new ROIService({ db });
  const harness = {
    db,
    service,
    async call(verb, args = {}) {
      const method = VERB_TO_METHOD.get(verb);
      if (!method || typeof service[method] !== "function") {
        throw new Error(`unknown verb: ${verb}`);
      }
      let result = await dispatchVerb({ db, service, verb, method, args });
      if (!["run_create", "run_resume"].includes(verb)) {
        return result;
      }
      while (result.failure_reason?.includes("orientation") && result.task) {
        const plan = service.planGet({ plan_id: result.task.plan_id }).plan;
        if (result.task.payload?.stage_kind === "implement") {
          await refreshImplementationOrientation(harness, plan.mission_id, plan, result.run.id, result.task.id);
        } else {
          await refreshVerificationOrientation(harness, plan.mission_id, plan, result.run.id, result.task.id);
        }
        service.taskResume({ task_id: result.task.id });
        result = await service.runResume({ run_id: result.run.id });
      }
      return result;
    }
  };
  return harness;
}

export function createPlanningOrientation(plan, evidenceSource = "lifecycle test fixture") {
  return {
    status: "current",
    workspace_root: "roi-test-workspace",
    instruction_sources: ["roi/AGENTS.md"],
    source_artifacts: ["lifecycle helper test fixture"],
    live_state_identity: "fixture:planning-current",
    authority_constraints: ["current checkout only"],
    owner_seams: [{
      id: "OS1",
      owner: plan.name,
      seam: plan.scope || "lifecycle test seam",
      evidence_sources: [evidenceSource]
    }],
    material_uncertainties: [],
    proof_obligations: (plan.verification_targets ?? []).map((target, index) => ({
      id: `PO${index + 1}`,
      obligation: `prove ${target}`,
      owner_seam_ids: ["OS1"],
      verification_targets: [target]
    })),
    execution_preconditions: ["plan revision is current"],
    completion_basis: "owner_seam_coverage_and_material_uncertainty"
  };
}

export async function refreshVerificationOrientation(harness, missionId, plan, runId = "", taskId) {
  const targetBundle = plan.verification_targets.join("\n");
  return harness.call("orientation_refresh", {
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

export async function refreshImplementationOrientation(harness, missionId, plan, runId = "", taskId) {
  const actionBundle = plan.actions.join("\n");
  return harness.call("orientation_refresh", {
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
    checked_preconditions: ["plan revision and action bundle are current"],
    observed_owner_seam_ids: plan.planning_orientation.owner_seams.map((item) => item.id),
    reason: "pre_mutation"
  });
}
