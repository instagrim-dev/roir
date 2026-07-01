import crypto from "node:crypto";
import { A2AExecutor } from "./a2a.mjs";
import {
  filterReviewBlockingIssues,
  isLocalImplementStubOutput,
  missionGoProgress,
  missionImplementationProofTrust,
  missionNeedsRoiGo,
  partialVerificationCheckpoint,
  partialVerificationEligible,
  pausedRunNextActions,
  substantiveRoiGoForPlan,
  latestRoiGoVerificationByPlan,
  runPlansHaveMcpVerifiedGoEvidence,
  runPlansHaveMcpVerifiedGoEvidenceForSubstantive,
  validateRoiGoVerificationPass,
  defaultRoiWorkspaceRoot,
  verifyGateNextActions
} from "./implementationProof.mjs";
import {
  missionRequiresHelperVerifiedProof,
  missionVerificationPolicyFromBrief,
  validatePerPlanProofDistinctness,
  validateStrictMissionGoEvidence
} from "./missionVerificationPolicy.mjs";
import { applyMcpOracleVerification, applyVerifyGateOracleVerification } from "./oracleRunner.mjs";
import { AgentExecutor } from "./agentExecutor.mjs";
import { normalizeInlinePlan } from "./planIntake.mjs";
import {
  CapabilityPromotionSource,
  CapabilityStatus,
  DEFAULT_REVIEW_POLICY_REFS,
  DEFAULT_WORKFLOW_TEMPLATE,
  MissionStatus,
  PatternStatus,
  ReviewVerdict,
  ROI_SCHEMA_VERSION,
  RunStatus,
  StageKind,
  SYSTEM_SCOPE_ID,
  TaskStatus,
  VerifyVerdict
} from "./contracts.mjs";

const MISSION_ACTIVE = MissionStatus.ACTIVE;
const MISSION_ARCHIVED = MissionStatus.ARCHIVED;

const RUN_QUEUED = RunStatus.QUEUED;
const RUN_RUNNING = RunStatus.RUNNING;
const RUN_COMPLETED = RunStatus.COMPLETED;
const RUN_FAILED = RunStatus.FAILED;
const RUN_BLOCKED = RunStatus.BLOCKED;
const RUN_PAUSED = RunStatus.PAUSED;
const RUN_CANCELLED = RunStatus.CANCELLED;

const TASK_QUEUED = TaskStatus.QUEUED;
const TASK_RUNNING = TaskStatus.RUNNING;
const TASK_COMPLETED = TaskStatus.COMPLETED;
const TASK_FAILED = TaskStatus.FAILED;
const TASK_PAUSED = TaskStatus.PAUSED;
const TASK_INPUT_REQUIRED = TaskStatus.INPUT_REQUIRED;
const TASK_AUTH_REQUIRED = TaskStatus.AUTH_REQUIRED;
const TASK_WAITING = TaskStatus.WAITING_ON_EXTERNAL;
const TASK_APPROVAL_REQUIRED = TaskStatus.APPROVAL_REQUIRED;
const TASK_CANCELLED = TaskStatus.CANCELLED;

const DEFAULT_CAPABILITY_ID = "general_delivery_workflow";
const DEBUG_CAPABILITY_ID = "debugging_workflow";
const CONVERGENCE_STATE_DRAFTING = "drafting";
const CONVERGENCE_STATE_ACTIVE = "active";
const CONVERGENCE_STATE_PAUSED_FOR_JUDGMENT = "paused_for_judgment";
const CONVERGENCE_STATE_BLOCKED = "blocked";
const CONVERGENCE_STATE_CONVERGED = "converged";
const CONVERGENCE_STATE_RESIDUAL_GAP = "residual_gap_deferred";
const CONVERGENCE_SCOPE_DECLARED_MANIFEST = "declared_manifest";

export class ROIService {
  constructor({ db, localExecutor, agentExecutor, a2aExecutor, policyEvaluator, now = () => new Date() }) {
    this.db = db;
    this.localExecutor = localExecutor ?? new LocalExecutor();
    this.agentExecutor = agentExecutor ?? new AgentExecutor();
    this.a2aExecutor = a2aExecutor ?? new A2AExecutor();
    this.policyEvaluator = policyEvaluator ?? defaultPolicyEvaluator;
    this.now = now;
    this._stmts = {
      missions_get_by_id:            db.prepare(`SELECT * FROM missions WHERE id = ?`),
      missions_list_all:             db.prepare(`SELECT * FROM missions ORDER BY updated_at DESC`),
      briefs_get_latest:             db.prepare(`SELECT data_json FROM briefs WHERE mission_id = ? ORDER BY revision DESC LIMIT 1`),
      briefs_list_by_mission:        db.prepare(`SELECT data_json FROM briefs WHERE mission_id = ? ORDER BY revision DESC`),
      briefs_max_revision:           db.prepare(`SELECT COALESCE(MAX(revision), 0) AS revision FROM briefs WHERE mission_id = ?`),
      plans_get_latest:              db.prepare(`SELECT data_json FROM plans WHERE id = ? ORDER BY revision DESC LIMIT 1`),
      plans_max_revision:            db.prepare(`SELECT COALESCE(MAX(revision), 0) AS revision FROM plans WHERE id = ?`),
      plans_list_latest_by_mission:  db.prepare(`SELECT id, MAX(updated_at) AS latest_updated_at FROM plans WHERE mission_id = ? GROUP BY id ORDER BY latest_updated_at DESC`),
      runs_get_by_id:                db.prepare(`SELECT data_json FROM runs WHERE id = ?`),
      runs_list_by_mission:          db.prepare(`SELECT data_json FROM runs WHERE mission_id = ? ORDER BY updated_at DESC`),
      tasks_get_by_id:               db.prepare(`SELECT data_json FROM tasks WHERE id = ?`),
      tasks_list_by_run:             db.prepare(`SELECT data_json FROM tasks WHERE run_id = ? ORDER BY created_at ASC`),
      tasks_list_by_mission:         db.prepare(`SELECT data_json FROM tasks WHERE mission_id = ? ORDER BY created_at ASC`),
      evidence_list_by_mission:      db.prepare(`SELECT data_json FROM evidence WHERE mission_id = ? ORDER BY captured_at DESC`),
      evidence_list_by_run:          db.prepare(`SELECT data_json FROM evidence WHERE run_id = ? ORDER BY captured_at DESC`),
      evidence_count_by_mission:     db.prepare(`SELECT COUNT(*) AS n FROM evidence WHERE mission_id = ?`),
      traces_get_by_id:              db.prepare(`SELECT data_json FROM traces WHERE id = ?`),
      traces_list_by_mission:        db.prepare(`SELECT data_json FROM traces WHERE mission_id = ? ORDER BY created_at DESC`),
      traces_list_by_run:            db.prepare(`SELECT data_json FROM traces WHERE run_id = ? ORDER BY created_at DESC`),
      traces_count_by_mission:       db.prepare(`SELECT COUNT(*) AS n FROM traces WHERE mission_id = ?`),
      activations_get_by_id:         db.prepare(`SELECT data_json FROM capability_activations WHERE id = ?`),
      activations_list_by_mission:   db.prepare(`SELECT data_json FROM capability_activations WHERE mission_id = ? ORDER BY created_at ASC`),
      activations_list_by_run:       db.prepare(`SELECT data_json FROM capability_activations WHERE run_id = ? ORDER BY created_at ASC`),
      reviews_get_by_id:             db.prepare(`SELECT data_json FROM review_records WHERE id = ?`),
      reviews_list_by_mission:       db.prepare(`SELECT data_json FROM review_records WHERE mission_id = ? ORDER BY created_at ASC`),
      reviews_list_by_run:           db.prepare(`SELECT data_json FROM review_records WHERE run_id = ? ORDER BY created_at ASC`),
      routing_get_by_plan:           db.prepare(`SELECT data_json FROM routing_decisions WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1`),
      routing_list_by_mission:       db.prepare(`SELECT data_json FROM routing_decisions WHERE mission_id = ? ORDER BY created_at ASC`),
      patterns_list_by_mission:      db.prepare(`SELECT data_json FROM patterns WHERE mission_id = ? ORDER BY updated_at DESC`),
      convergence_ctrl_get:          db.prepare(`SELECT data_json FROM convergence_controllers WHERE mission_id = ?`),
      convergence_seams_list:        db.prepare(`SELECT data_json FROM convergence_seams WHERE mission_id = ? ORDER BY updated_at ASC`),
      convergence_seam_get:          db.prepare(`SELECT data_json FROM convergence_seams WHERE id = ?`),
      capabilities_exists:           db.prepare(`SELECT 1 FROM capabilities WHERE id = ? LIMIT 1`),
    };
    this._ensureBuiltinCapabilities();
  }

  missionCreate(input = {}) {
    const timestamp = this.now().toISOString();
    const mission = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("mission"),
      title: input.title?.trim() || "Untitled mission",
      goal: input.goal?.trim() || input.title?.trim() || "Untitled mission",
      status: MISSION_ACTIVE,
      priority: input.priority?.trim() || "normal",
      owner: input.owner?.trim() || "",
      workspace_refs: asArray(input.workspace_refs),
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.prepare(`
      INSERT INTO missions (id, title, goal, status, priority, owner, workspace_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mission.id,
      mission.title,
      mission.goal,
      mission.status,
      mission.priority,
      mission.owner,
      json(mission.workspace_refs),
      mission.created_at,
      mission.updated_at
    );

    const brief = this._insertBrief({
      mission_id: mission.id,
      problem: mission.goal,
      constraints: [],
      success_criteria: [],
      non_goals: [],
      assumptions: [],
      open_questions: [],
      audience: input.audience?.trim() || ""
    });

    if (input.convergence) {
      this._upsertConvergenceController({
        ...this._buildConvergenceController({
          mission_id: mission.id,
          title: mission.title,
          goal: mission.goal,
          convergence: input.convergence
        }),
        created_at: timestamp
      });
    }

    return mutation({
      status: "ok",
      summary: "Mission created",
      next_actions: ["roi:brief"]
    }, { mission: this._decorateMission(mission), brief });
  }

  missionGet({ mission_id }) {
    return { mission: this._getMission(mission_id) };
  }

  missionList() {
    const rows = this._stmts.missions_list_all.all();
    return { missions: rows.map((row) => this._decorateMission(parseMissionRow(row))) };
  }

  missionUpdate(input) {
    const mission = this._getMission(input.mission_id);
    const updated = {
      ...mission,
      title: input.title?.trim() || mission.title,
      goal: input.goal?.trim() || mission.goal,
      priority: input.priority?.trim() || mission.priority,
      owner: input.owner?.trim() || mission.owner,
      status: input.status?.trim() || mission.status,
      workspace_refs: input.workspace_refs ? asArray(input.workspace_refs) : mission.workspace_refs,
      updated_at: this.now().toISOString()
    };
    this.db.prepare(`
      UPDATE missions
      SET title = ?, goal = ?, status = ?, priority = ?, owner = ?, workspace_refs_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.title,
      updated.goal,
      updated.status,
      updated.priority,
      updated.owner,
      json(updated.workspace_refs),
      updated.updated_at,
      updated.id
    );
    if (input.convergence) {
      const current = this._getConvergenceController(updated.id);
      this._upsertConvergenceController({
        ...(current || this._buildConvergenceController({
          mission_id: updated.id,
          title: updated.title,
          goal: updated.goal,
          convergence: input.convergence
        })),
        ...this._mergeConvergenceController(current, {
          mission_id: updated.id,
          title: updated.title,
          goal: updated.goal,
          convergence: input.convergence
        })
      });
    }
    return mutation({ status: "ok", summary: "Mission updated" }, { mission: this._decorateMission(updated) });
  }

  missionArchive({ mission_id }) {
    return this.missionUpdate({ mission_id, status: MISSION_ARCHIVED });
  }

  briefRevise(input) {
    const mission = this._getMission(input.mission_id);
    const latest = this._getLatestBrief(input.mission_id);
    const brief = this._insertBrief({
      mission_id: mission.id,
      problem: input.problem ?? latest?.problem ?? mission.goal,
      constraints: input.constraints ?? latest?.constraints ?? [],
      success_criteria: input.success_criteria ?? latest?.success_criteria ?? [],
      non_goals: input.non_goals ?? latest?.non_goals ?? [],
      assumptions: input.assumptions ?? latest?.assumptions ?? [],
      open_questions: input.open_questions ?? latest?.open_questions ?? [],
      audience: input.audience ?? latest?.audience ?? ""
    });
    this._touchMission(mission.id);
    return mutation({ status: "ok", summary: "Brief revised", next_actions: ["roi:source", "roi:outline"] }, { brief });
  }

  briefGetLatest({ mission_id }) {
    return { brief: this._getLatestBrief(mission_id) };
  }

  briefListRevisions({ mission_id }) {
    const rows = this._stmts.briefs_list_by_mission.all(mission_id);
    return { briefs: rows.map((row) => parseRowJson(row.data_json, "entity")) };
  }

  researchRecord(input) {
    this._getMission(input.mission_id);
    const record = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("research"),
      mission_id: input.mission_id,
      question: input.question?.trim() || "",
      sources: asArray(input.sources),
      findings: asArray(input.findings),
      tradeoffs: asArray(input.tradeoffs),
      recommendation: input.recommendation?.trim() || "",
      confidence: Number(input.confidence ?? 0),
      created_at: this.now().toISOString()
    };
    this.db.prepare(`
      INSERT INTO research_records (id, mission_id, data_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(record.id, record.mission_id, json(record), record.created_at);
    this._touchMission(input.mission_id);
    return mutation({ status: "ok", summary: "Research recorded", next_actions: ["roi:outline"] }, { research: record });
  }

  researchList({ mission_id }) {
    const rows = this.db.prepare(`SELECT data_json FROM research_records WHERE mission_id = ? ORDER BY created_at DESC`).all(mission_id);
    return { research: rows.map((row) => parseRowJson(row.data_json, "entity")) };
  }

  researchSummarize({ mission_id }) {
    const records = this.researchList({ mission_id }).research;
    return {
      mission_id,
      count: records.length,
      summary: records.map((record) => record.recommendation || record.question).filter(Boolean).join("\n")
    };
  }

  planGenerate(input) {
    const mission = this._getMission(input.mission_id);
    const brief = this._getLatestBrief(mission.id);
    const controller = this._getConvergenceController(mission.id);
    const requestedSeams =
      controller && Array.isArray(input.seams) && input.seams.length > 0
        ? input.seams
        : controller && Array.isArray(input.plans) && input.plans.length > 0
          ? input.plans.map((plan, index) => ({
              id: plan.convergence_seam_id,
              title: plan.name?.trim() || `Seam ${index + 1}`,
              summary: plan.scope?.trim() || "",
              expected_maturity_gain: Math.max(0, (input.plans.length - index)),
              unlock_score: 0,
              evidence_confidence: 0,
              requires_judgment: false,
              manifest_order: index + 1,
              plan
            }))
          : [];
    if (controller && requestedSeams.length > 0) {
      const generated = this._generateConvergencePlans({
        mission,
        brief,
        controller,
        input: {
          ...input,
          seams: requestedSeams
        }
      });
      this._touchMission(mission.id);
      return mutation(
        {
          status: "ok",
          summary: "Convergence seams generated",
          next_actions:
            generated.controller.state === CONVERGENCE_STATE_ACTIVE
              ? ["roi:draft"]
              : ["roi:inspect"]
        },
        {
          plans: generated.plans,
          seams: generated.seams,
          convergence: this._buildConvergenceSummary(mission.id)
        }
      );
    }
    const requestedPlans = Array.isArray(input.plans) && input.plans.length > 0
      ? input.plans
      : [{
          name: `${mission.title} implementation`,
          scope: brief?.problem || mission.goal,
          actions: [brief?.problem || mission.goal],
          dependencies: [],
          verification_targets: brief?.success_criteria?.length ? brief.success_criteria : ["Deliver the mission goal"],
          source_contract_refs: [],
          requires_source_contract_check: false,
          wave: 1
        }];

    const plans = [];
    const routingDecisions = [];
    for (const [index, requestedPlan] of requestedPlans.entries()) {
      const planId = requestedPlan.id || newId("plan");
      const draftPlan = {
        id: planId,
        mission_id: mission.id,
        name: requestedPlan.name?.trim() || `Plan ${index + 1}`,
        scope: requestedPlan.scope?.trim() || brief?.problem || mission.goal,
        inputs: asArray(requestedPlan.inputs),
        actions: asArray(requestedPlan.actions),
        dependencies: asArray(requestedPlan.dependencies),
        verification_targets: asArray(requestedPlan.verification_targets),
        source_contract_refs: asArray(requestedPlan.source_contract_refs),
        requires_source_contract_check: Boolean(requestedPlan.requires_source_contract_check),
        status: requestedPlan.status?.trim() || "planned",
        wave: Number(requestedPlan.wave ?? index + 1)
      };
      const routing = this._resolveRoutingDecision({
        mission,
        brief,
        plan: draftPlan,
        mode: "local",
        persist: true
      });
      routingDecisions.push(routing);
      const capability = this._getLatestCapability(routing.capability_id);
      plans.push(this._insertPlan({
        ...draftPlan,
        capability_id: capability.id,
        workflow_template_ref: capability.id,
        workflow_template: capability.workflow_template
      }));
    }

    this._touchMission(mission.id);
    return mutation({ status: "ok", summary: "Plans generated", next_actions: ["roi:draft"] }, { plans, routing_decisions: routingDecisions });
  }

  planGet({ plan_id }) {
    return { plan: this._getLatestPlan(plan_id) };
  }

  planList({ mission_id }) {
    return { plans: this._listLatestPlans(mission_id) };
  }

  planRevise(input) {
    const current = this._getLatestPlan(input.plan_id);
    if (
      current.convergence_seam_id &&
      input.convergence_seam_id &&
      input.convergence_seam_id !== current.convergence_seam_id
    ) {
      throw new Error(`plan ${current.id} is already bound to convergence seam ${current.convergence_seam_id}`);
    }
    const mission = this._getMission(current.mission_id);
    const brief = this._getLatestBrief(mission.id);
    const draftPlan = {
      ...current,
      name: input.name ?? current.name,
      scope: input.scope ?? current.scope,
      inputs: input.inputs ?? current.inputs,
      actions: input.actions ?? current.actions,
      dependencies: input.dependencies ?? current.dependencies,
      verification_targets: input.verification_targets ?? current.verification_targets,
      source_contract_refs: input.source_contract_refs ?? current.source_contract_refs,
      requires_source_contract_check: input.requires_source_contract_check ?? current.requires_source_contract_check,
      convergence_seam_id: input.convergence_seam_id ?? current.convergence_seam_id,
      status: input.status ?? current.status,
      wave: Number(input.wave ?? current.wave)
    };
    const routing = this._resolveRoutingDecision({
      mission,
      brief,
      plan: draftPlan,
      mode: "local",
      persist: true
    });
    const capability = this._getLatestCapability(routing.capability_id);
    const revised = this._insertPlan({
      ...draftPlan,
      id: current.id,
      mission_id: current.mission_id,
      capability_id: capability.id,
      workflow_template_ref: capability.id,
      workflow_template: capability.workflow_template
    });
    this._touchMission(current.mission_id);
    return mutation({ status: "ok", summary: "Plan revised" }, { plan: revised, routing_decision: routing });
  }

  planAssignWaves(input) {
    const updated = [];
    for (const assignment of input.assignments ?? []) {
      updated.push(this.planRevise({ plan_id: assignment.plan_id, wave: assignment.wave }));
    }
    return mutation({ status: "ok", summary: "Waves assigned" }, { plans: updated.map((item) => item.plan) });
  }

  planNormalize(input) {
    return {
      status: "ok",
      summary: "Inline plan normalized",
      normalized: normalizeInlinePlan(input)
    };
  }

  taskCreate(input) {
    this._getMission(input.mission_id);
    const task = this._insertTask({
      mission_id: input.mission_id,
      plan_id: input.plan_id ?? "",
      run_id: input.run_id ?? "",
      kind: input.kind?.trim() || "plan_task",
      status: input.status?.trim() || TASK_QUEUED,
      assignee: input.assignee?.trim() || "",
      checkpoint_ref: input.checkpoint_ref?.trim() || "",
      retry_count: Number(input.retry_count ?? 0),
      blocking_reason: input.blocking_reason?.trim() || "",
      payload: asObject(input.payload)
    });
    return mutation({ status: "ok", summary: "Task created" }, { task });
  }

  taskTransition(input) {
    const task = this._getTask(input.task_id);
    const updated = {
      ...task,
      status: input.status?.trim() || task.status,
      checkpoint_ref: input.checkpoint_ref ?? task.checkpoint_ref,
      blocking_reason: input.blocking_reason ?? task.blocking_reason,
      retry_count: Number(input.retry_count ?? task.retry_count),
      updated_at: this.now().toISOString()
    };
    this._updateTask(updated);
    return mutation({ status: "ok", summary: "Task transitioned" }, { task: updated });
  }

  taskList(input = {}) {
    let rows = [];
    if (input.run_id) {
      rows = this._stmts.tasks_list_by_run.all(input.run_id);
    } else if (input.mission_id) {
      rows = this._stmts.tasks_list_by_mission.all(input.mission_id);
    } else {
      rows = this.db.prepare(`SELECT data_json FROM tasks ORDER BY created_at ASC`).all();
    }
    const tasks = rows.map((row) => parseRowJson(row.data_json, "entity"));
    return { tasks: input.status ? tasks.filter((task) => task.status === input.status) : tasks };
  }

  taskResume({ task_id }) {
    return this.taskTransition({ task_id, status: TASK_QUEUED, blocking_reason: "", checkpoint_ref: "" });
  }

  async runCreate(input) {
    const mission = this._getMission(input.mission_id);
    const brief = this._getLatestBrief(mission.id);
    const mode = input.mode || "local";
    const controller = this._getConvergenceController(mission.id);
    if (controller) {
      this._assertConvergenceExecutablePlanIds({
        mission_id: mission.id,
        controller,
        plan_ids: input.plan_ids?.length ? input.plan_ids : [controller.active_plan_id]
      });
    }
    const plans = (input.plan_ids?.length ? input.plan_ids : controller?.active_plan_id ? [controller.active_plan_id] : this._listLatestPlans(mission.id).map((plan) => plan.id))
      .map((planId) => this._getLatestPlan(planId));

    if (plans.length === 0) {
      throw new Error(`mission ${mission.id} has no plans`);
    }

    const run = this._insertRun({
      mission_id: mission.id,
      status: RUN_QUEUED,
      summary: "",
      plan_ids: plans.map((plan) => plan.id),
      capabilities_used: [],
      context_pack_refs: [],
      deliverable_refs: [],
      task_refs: [],
      trace_refs: [],
      protocol_refs: [],
      checkpoint_refs: [],
      activation_refs: [],
      routing_refs: [],
      review_refs: []
    });

    const contextPack = this._insertContextPack({
      mission_id: mission.id,
      purpose:
        mode === "a2a"
          ? "workflow_remote_execution"
          : mode === "agent"
            ? "workflow_host_agent_execution"
            : "workflow_local_execution",
      sources: [mission.id, ...plans.map((plan) => plan.id)],
      constraints: brief?.constraints ?? [],
      budget: asObject(input.budget)
    });

    const taskRefs = [];
    const capabilityRefs = [];
    const activationRefs = [];
    const routingRefs = [];

    for (const plan of plans) {
      const routing = plan.capability_id
        ? this._getLatestRouteForPlan(plan.id) || this._resolveRoutingDecision({ mission, brief, plan, mode, persist: true })
        : this._resolveRoutingDecision({ mission, brief, plan, mode, persist: true });
      const capability = this._getLatestCapability(routing.capability_id);
      const activation = this._insertActivation({
        mission_id: mission.id,
        run_id: run.id,
        plan_id: plan.id,
        capability_id: capability.id,
        executor_mode: mode,
        workflow_template: capability.workflow_template,
        status: RUN_QUEUED,
        task_refs: []
      });
      const stageTasks = this._buildStageTasks({
        mission,
        plan,
        run,
        activation,
        capability,
        contextPack,
        input,
        mode
      });
      taskRefs.push(...stageTasks.map((task) => task.id));
      capabilityRefs.push(capability.id);
      activationRefs.push(activation.id);
      routingRefs.push(routing.id);
      this._updateActivation({
        ...activation,
        task_refs: stageTasks.map((task) => task.id),
        status: RUN_RUNNING
      });
    }

    const seededRun = this._updateRun({
      ...run,
      status: RUN_RUNNING,
      task_refs: taskRefs,
      context_pack_refs: [contextPack.id],
      capabilities_used: unique(capabilityRefs),
      activation_refs: activationRefs,
      routing_refs: routingRefs
    });

    return this._advanceRun(seededRun.id, input);
  }

  runGet({ run_id }) {
    return { run: this._getRun(run_id) };
  }

  runList(input = {}) {
    const rows = input.mission_id
      ? this._stmts.runs_list_by_mission.all(input.mission_id)
      : this.db.prepare(`SELECT data_json FROM runs ORDER BY updated_at DESC`).all();
    return { runs: rows.map((row) => parseRowJson(row.data_json, "entity")) };
  }

  async runResume({ run_id }) {
    const run = this._getRun(run_id);
    if (run.status === RUN_COMPLETED || run.status === RUN_CANCELLED || run.status === RUN_FAILED) {
      return mutation({ status: "noop", summary: `Run is already ${run.status}` }, { run });
    }
    const controller = this._getConvergenceController(run.mission_id);
    if (controller) {
      this._assertConvergenceExecutablePlanIds({
        mission_id: run.mission_id,
        controller,
        plan_ids: run.plan_ids
      });
    }
    return this._advanceRun(run.id, {});
  }

  runCancel({ run_id }) {
    const run = this._getRun(run_id);
    if (run.status === RUN_COMPLETED || run.status === RUN_CANCELLED || run.status === RUN_FAILED) {
      return mutation(
        { status: "noop", summary: `Run is already ${run.status}` },
        { run }
      );
    }
    const tasks = this.taskList({ run_id }).tasks.map((task) =>
      this._updateTask({ ...task, status: TASK_CANCELLED, blocking_reason: "cancelled by operator" })
    );
    const activations = this.activationList({ run_id }).activations.map((activation) =>
      this._updateActivation({ ...activation, status: RUN_CANCELLED })
    );
    const updatedRun = this._updateRun({ ...run, status: RUN_CANCELLED, summary: "Run cancelled" });
    return mutation({ status: "ok", summary: "Run cancelled" }, { run: updatedRun, tasks, activations });
  }

  evidenceRecord(input) {
    const mission = this._getMission(input.mission_id);
    const run = input.run_id ? this._getMissionRun(mission.id, input.run_id) : null;
    const source = input.source?.trim() || "manual";
    const evidenceType = input.type?.trim() || "note";
    const content = asObject(input.content);
    const brief = this._getLatestBrief(mission.id);
    const missionEvidence = this.evidenceList({ mission_id: mission.id }).evidence;

    if (evidenceType === "quality_review") {
      const evidence = this._insertEvidence({
        mission_id: mission.id,
        run_id: run?.id ?? "",
        type: evidenceType,
        source: source || "quality_review",
        result: input.result?.trim() || "",
        artifact_ref: input.artifact_ref?.trim() || "",
        content
      });
      return mutation({ status: "ok", summary: "Quality review evidence recorded" }, { evidence });
    }

    if (["publication", "handoff"].includes(evidenceType)) {
      this._assertPublicationEvidenceRun({ run, evidenceType });
    }

    let planForProof = null;
    if (source === "roi:go" && evidenceType === "verification") {
      const planId = String(content.plan_id ?? content.planId ?? "").trim();
      if (planId) {
        planForProof = this._getLatestPlan(planId);
        if (planForProof.mission_id !== mission.id) {
          throw new Error(`plan ${planId} does not belong to mission ${mission.id}`);
        }
        content.plan_id = planId;
        content.plan_revision = planForProof.revision;
      }
    }
    validateStrictMissionGoEvidence(input, brief);
    if (source === "roi:go" && evidenceType === "verification" && planForProof) {
      validatePerPlanProofDistinctness({
        content,
        evidenceList: missionEvidence,
        planId: planForProof.id
      });
    }
    if (input.run_oracles === true) {
      if (source !== "roi:go" || evidenceType !== "verification") {
        throw new Error("run_oracles is only supported for roi:go verification evidence");
      }
      if (!planForProof) {
        throw new Error("run_oracles requires content.plan_id for a mission plan");
      }
      const { oracles_ok: mcpOraclesOk } = applyMcpOracleVerification(content, planForProof, {
        workspaceRoot: defaultRoiWorkspaceRoot()
      });
      const passAttempt = String(input.result ?? "")
        .trim()
        .toLowerCase() === "pass";
      if (passAttempt && !mcpOraclesOk) {
        throw new Error(
          "evidence_record blocked: run_oracles failed one or more verification_targets"
        );
      }
    }
    if (input.product_tree) {
      content.product_tree = String(input.product_tree).trim().toLowerCase();
    }
    validateRoiGoVerificationPass(
      {
        result: input.result,
        source,
        type: evidenceType,
        content
      },
      { plan: planForProof },
      {
        workspaceRoot: defaultRoiWorkspaceRoot(),
        plan: planForProof,
        productTree: input.product_tree,
        porcelainCheck: Boolean(input.product_tree)
      }
    );
    const controller = this._getConvergenceController(input.mission_id);
    if (controller && ["publication", "handoff"].includes(evidenceType)) {
      this._assertConvergencePublicationRun({ controller, run });
    }
    const evidence = this._insertEvidence({
      mission_id: mission.id,
      run_id: run?.id ?? "",
      type: evidenceType,
      source,
      result: input.result?.trim() || "",
      artifact_ref: input.artifact_ref?.trim() || "",
      content
    });
    if (controller && ["publication", "handoff"].includes(evidence.type)) {
      const finalized = this._finalizeConvergencePublication({
        controller,
        run,
        evidence
      });
      return mutation({ status: "ok", summary: "Evidence recorded" }, { evidence, convergence: finalized });
    }
    return mutation({ status: "ok", summary: "Evidence recorded" }, { evidence });
  }

  evidenceList({ mission_id, run_id = "" }) {
    const rows = run_id
      ? this._stmts.evidence_list_by_run.all(run_id)
      : this._stmts.evidence_list_by_mission.all(mission_id);
    return { evidence: rows.map((row) => parseRowJson(row.data_json, "entity")) };
  }

  traceRecord(input) {
    this._getMission(input.mission_id);
    const trace = this._insertTrace({
      mission_id: input.mission_id,
      run_id: input.run_id ?? "",
      task_id: input.task_id ?? "",
      events: asArray(input.events),
      tool_calls: asArray(input.tool_calls),
      latency_ms: Number(input.latency_ms ?? 0),
      token_usage: asObject(input.token_usage),
      error_signals: asArray(input.error_signals),
      evaluation_refs: asArray(input.evaluation_refs)
    });
    return mutation({ status: "ok", summary: "Trace recorded", trace_refs: [trace.id] }, { trace });
  }

  traceGet({ trace_id }) {
    const row = this._stmts.traces_get_by_id.get(trace_id);
    if (!row) {
      throw new Error(`trace ${trace_id} not found`);
    }
    return { trace: parseRowJson(row.data_json, "entity") };
  }

  traceList({ mission_id, run_id = "" }) {
    const rows = run_id
      ? this._stmts.traces_list_by_run.all(run_id)
      : this._stmts.traces_list_by_mission.all(mission_id);
    return { traces: rows.map((row) => parseRowJson(row.data_json, "entity")) };
  }

  policyEvaluate(input) {
    const decision = this._insertPolicyDecision(this.policyEvaluator({
      mission_id: input.mission_id ?? "",
      run_id: input.run_id ?? "",
      task_id: input.task_id ?? "",
      subject: input.subject?.trim() || "",
      mode: input.mode?.trim() || "local"
    }));
    return mutation({ status: "ok", summary: "Policy evaluated" }, { policy_decision: decision });
  }

  policyRecordDecision(input) {
    const decision = this._insertPolicyDecision({
      id: input.id || newId("policy"),
      mission_id: input.mission_id ?? "",
      run_id: input.run_id ?? "",
      task_id: input.task_id ?? "",
      subject: input.subject?.trim() || "",
      decision: input.decision?.trim() || "allow",
      reason: input.reason?.trim() || "",
      policy_pack_ref: input.policy_pack_ref?.trim() || "roi-default",
      created_at: this.now().toISOString()
    });
    return mutation({ status: "ok", summary: "Policy decision recorded" }, { policy_decision: decision });
  }

  protocolBind(input) {
    const binding = this._insertProtocolBinding({
      mission_id: input.mission_id ?? "",
      run_id: input.run_id ?? "",
      task_id: input.task_id ?? "",
      protocol: input.protocol?.trim() || "unknown",
      endpoint: input.endpoint?.trim() || "",
      auth_mode: input.auth_mode?.trim() || "",
      artifact_contract: input.artifact_contract?.trim() || "",
      status: input.status?.trim() || "",
      payload: asObject(input.payload)
    });
    return mutation({ status: "ok", summary: "Protocol binding recorded" }, { protocol_binding: binding });
  }

  protocolListBindings({ run_id = "", task_id = "" }) {
    let rows = [];
    if (task_id) {
      rows = this.db.prepare(`SELECT data_json FROM protocol_bindings WHERE task_id = ? ORDER BY updated_at DESC`).all(task_id);
    } else if (run_id) {
      rows = this.db.prepare(`SELECT data_json FROM protocol_bindings WHERE run_id = ? ORDER BY updated_at DESC`).all(run_id);
    } else {
      rows = this.db.prepare(`SELECT data_json FROM protocol_bindings ORDER BY updated_at DESC`).all();
    }
    return { protocol_bindings: rows.map((row) => parseRowJson(row.data_json, "entity")) };
  }

  capabilityRegister(input) {
    const capability = this._insertCapability({
      id: input.capability_id || newId("capability"),
      mission_id: input.mission_id ?? SYSTEM_SCOPE_ID,
      name: input.name,
      type: input.type ?? "workflow",
      triggers: asArray(input.triggers),
      inputs: asArray(input.inputs),
      outputs: asArray(input.outputs),
      protocols: asArray(input.protocols),
      policy_scope: input.policy_scope ?? "registry-first",
      matchers: asObject(input.matchers),
      workflow_template: asStageArray(input.workflow_template, DEFAULT_WORKFLOW_TEMPLATE),
      review_policy_refs: asArray(input.review_policy_refs).length ? asArray(input.review_policy_refs) : [...DEFAULT_REVIEW_POLICY_REFS],
      executor_modes: asExecutorModes(input.executor_modes),
      promotion_source: input.promotion_source ?? CapabilityPromotionSource.HAND_AUTHORED,
      usage_count: Number(input.usage_count ?? 0),
      effectiveness_score: Number(input.effectiveness_score ?? 0),
      status: CapabilityStatus.PROMOTED,
      payload: asObject(input.payload)
    });
    return mutation({ status: "ok", summary: "Capability registered" }, { capability });
  }

  capabilityMatch(input) {
    const mission = this._getMission(input.mission_id);
    const brief = this._getLatestBrief(input.mission_id);
    const plan = input.plan_id ? this._getLatestPlan(input.plan_id) : null;
    const matched = this._matchCapability({ mission, brief, plan, mode: input.mode || "local" });
    return {
      capability: matched.capability,
      confidence: matched.confidence,
      reason: matched.reason,
      rejected_alternatives: matched.rejected_alternatives
    };
  }

  capabilityPropose(input) {
    const mission = this._getMission(input.mission_id);
    const capability = this._insertCapability({
      id: input.capability_id || newId("capability"),
      mission_id: mission.id,
      name: input.name?.trim() || `${mission.title} capability`,
      type: input.type?.trim() || "workflow",
      triggers: asArray(input.triggers),
      inputs: asArray(input.inputs),
      outputs: asArray(input.outputs),
      protocols: asArray(input.protocols),
      policy_scope: input.policy_scope?.trim() || "human-gated",
      matchers: asObject(input.matchers),
      workflow_template: asStageArray(input.workflow_template, DEFAULT_WORKFLOW_TEMPLATE),
      review_policy_refs: asArray(input.review_policy_refs).length ? asArray(input.review_policy_refs) : [...DEFAULT_REVIEW_POLICY_REFS],
      executor_modes: asExecutorModes(input.executor_modes),
      promotion_source: input.promotion_source ?? CapabilityPromotionSource.ENLIGHTEN_PROPOSED,
      usage_count: Number(input.usage_count ?? 0),
      effectiveness_score: Number(input.effectiveness_score ?? 0),
      status: CapabilityStatus.PROPOSED,
      payload: asObject(input.payload)
    });
    return mutation({ status: "ok", summary: "Capability proposed", next_actions: ["capability.promote"] }, { capability });
  }

  capabilityPromote(input) {
    const current = this._getLatestCapability(input.capability_id);
    const promoted = this._insertCapability({
      ...current,
      id: current.id,
      mission_id: current.mission_id,
      name: input.name ?? current.name,
      type: input.type ?? current.type,
      triggers: input.triggers ?? current.triggers,
      inputs: input.inputs ?? current.inputs,
      outputs: input.outputs ?? current.outputs,
      protocols: input.protocols ?? current.protocols,
      policy_scope: input.policy_scope ?? current.policy_scope,
      matchers: input.matchers ?? current.matchers,
      workflow_template: input.workflow_template ?? current.workflow_template,
      review_policy_refs: input.review_policy_refs ?? current.review_policy_refs,
      executor_modes: input.executor_modes ?? current.executor_modes,
      promotion_source: input.promotion_source ?? CapabilityPromotionSource.ENLIGHTEN_PROMOTED,
      usage_count: Number(input.usage_count ?? current.usage_count),
      effectiveness_score: Number(input.effectiveness_score ?? current.effectiveness_score),
      status: CapabilityStatus.PROMOTED,
      payload: input.payload ?? current.payload
    });
    return mutation({ status: "ok", summary: "Capability promoted" }, { capability: promoted });
  }

  capabilityList({ mission_id } = {}) {
    this._ensureBuiltinCapabilities();
    let rows = [];
    if (mission_id) {
      rows = this.db.prepare(`
        SELECT id, MAX(updated_at) AS latest_updated_at
        FROM capabilities
        WHERE mission_id IN (?, ?)
        GROUP BY id
        ORDER BY latest_updated_at DESC
      `).all(SYSTEM_SCOPE_ID, mission_id);
    } else {
      rows = this.db.prepare(`
        SELECT id, MAX(updated_at) AS latest_updated_at
        FROM capabilities
        GROUP BY id
        ORDER BY latest_updated_at DESC
      `).all();
    }
    return { capabilities: rows.map((row) => this._getLatestCapability(row.id)) };
  }

  routeResolve(input) {
    const mission = this._getMission(input.mission_id);
    const brief = this._getLatestBrief(input.mission_id);
    const plan = input.plan_id ? this._getLatestPlan(input.plan_id) : null;
    const routing = this._resolveRoutingDecision({
      mission,
      brief,
      plan,
      mode: input.mode || "local",
      persist: true
    });
    return mutation({ status: "ok", summary: "Route resolved" }, { routing_decision: routing });
  }

  routeList({ mission_id = "", plan_id = "", capability_id = "" } = {}) {
    const rows = mission_id
      ? this._stmts.routing_list_by_mission.all(mission_id)
      : this.db.prepare(`SELECT data_json FROM routing_decisions ORDER BY created_at ASC`).all();
    const decisions = rows.map((row) => parseRowJson(row.data_json, "entity")).filter((decision) =>
      (!plan_id || decision.plan_id === plan_id) &&
      (!capability_id || decision.capability_id === capability_id)
    );
    return { routing_decisions: decisions };
  }

  activationCreate(input) {
    const activation = this._insertActivation({
      mission_id: input.mission_id,
      run_id: input.run_id,
      plan_id: input.plan_id,
      capability_id: input.capability_id,
      executor_mode: input.executor_mode,
      workflow_template: asStageArray(input.workflow_template, DEFAULT_WORKFLOW_TEMPLATE),
      status: RUN_QUEUED,
      task_refs: []
    });
    return mutation({ status: "ok", summary: "Capability activation created" }, { activation });
  }

  activationGet({ activation_id }) {
    return { activation: this._getActivation(activation_id) };
  }

  activationList({ mission_id = "", run_id = "", capability_id = "" } = {}) {
    let rows;
    if (mission_id) {
      rows = this._stmts.activations_list_by_mission.all(mission_id);
    } else if (run_id) {
      rows = this._stmts.activations_list_by_run.all(run_id);
    } else {
      rows = this.db.prepare(`SELECT data_json FROM capability_activations ORDER BY created_at ASC`).all();
    }
    const activations = rows.map((row) => parseRowJson(row.data_json, "entity")).filter((activation) =>
      (!mission_id || activation.mission_id === mission_id) &&
      (!run_id || activation.run_id === run_id) &&
      (!capability_id || activation.capability_id === capability_id)
    );
    return { activations };
  }

  reviewRecord(input) {
    const review = this._insertReviewRecord({
      mission_id: input.mission_id,
      run_id: input.run_id,
      task_id: input.task_id,
      activation_id: input.activation_id ?? "",
      review_type: input.review_type,
      subject_ref: input.subject_ref,
      verdict: input.verdict,
      blocking_issues: asArray(input.blocking_issues),
      evidence_refs: asArray(input.evidence_refs),
      trace_refs: asArray(input.trace_refs)
    });
    return mutation({ status: "ok", summary: "Review recorded" }, { review });
  }

  reviewGet({ review_id }) {
    return { review: this._getReviewRecord(review_id) };
  }

  reviewList({ mission_id = "", run_id = "", activation_id = "" } = {}) {
    let rows;
    if (mission_id) {
      rows = this._stmts.reviews_list_by_mission.all(mission_id);
    } else if (run_id) {
      rows = this._stmts.reviews_list_by_run.all(run_id);
    } else {
      rows = this.db.prepare(`SELECT data_json FROM review_records ORDER BY created_at ASC`).all();
    }
    const reviews = rows.map((row) => parseRowJson(row.data_json, "entity")).filter((review) =>
      (!mission_id || review.mission_id === mission_id) &&
      (!run_id || review.run_id === run_id) &&
      (!activation_id || review.activation_id === activation_id)
    );
    return { reviews };
  }

  verifyEvaluate(input) {
    const run = this._getRun(input.run_id);
    const verdict = input.verdict?.trim() || VerifyVerdict.PASS;
    const allowPartial = input.allow_partial_verification === true;
    if (allowPartial && verdict !== VerifyVerdict.PASS) {
      throw new Error(
        "allow_partial_verification is only supported with verdict pass (use verdict partial for honest incomplete review)"
      );
    }

    const missionPlans = this.planList({ mission_id: run.mission_id }).plans;
    const missionEvidence = this.evidenceList({ mission_id: run.mission_id }).evidence;
    const brief = this._getLatestBrief(run.mission_id);
    const checkpoint = partialVerificationCheckpoint(missionPlans, missionEvidence, run.plan_ids);
    const partialCheckpoint = allowPartial && checkpoint.partial_checkpoint;
    const policyStrict = missionRequiresHelperVerifiedProof(brief);
    const requireVerifiedProof =
      input.require_verified_proof === true ||
      (policyStrict && verdict === VerifyVerdict.PASS && !allowPartial);

    if (verdict === VerifyVerdict.PASS && allowPartial && !checkpoint.allowed) {
      throw new Error(
        "verify_evaluate(pass) blocked: allow_partial_verification requires at least one substantive roi:go plan in run scope"
      );
    }
    if (
      verdict === VerifyVerdict.PASS &&
      !allowPartial &&
      this._missionNeedsRoiGo(run.mission_id, { planIds: run.plan_ids })
    ) {
      throw new Error(
        "verify_evaluate(pass) blocked: run plan(s) still need substantive roi:go verification evidence"
      );
    }
    if (verdict === VerifyVerdict.PASS && requireVerifiedProof) {
      const mcpOk = partialCheckpoint
        ? runPlansHaveMcpVerifiedGoEvidenceForSubstantive(missionPlans, missionEvidence, run.plan_ids)
        : runPlansHaveMcpVerifiedGoEvidence(missionPlans, missionEvidence, run.plan_ids);
      if (!mcpOk) {
        throw new Error(
          "verify_evaluate(pass) blocked: require_verified_proof but run plan(s) lack mcp_verified roi:go evidence (use evidence.record with run_oracles: true)"
        );
      }
    }
    const content = {
      notes: input.notes?.trim() || "",
      brief_revision: brief?.revision ?? 0,
      plan_ids: run.plan_ids,
      verification_policy: missionVerificationPolicyFromBrief(brief)
    };
    if (input.run_oracles === true) {
      const oraclePlanIds = partialCheckpoint ? checkpoint.substantive_plan_ids : run.plan_ids;
      const plans = oraclePlanIds.map((planId) => this._getLatestPlan(planId));
      const { oracles_ok: gateOraclesOk } = applyVerifyGateOracleVerification(content, plans, {
        workspaceRoot: defaultRoiWorkspaceRoot()
      });
      if (verdict === VerifyVerdict.PASS && !gateOraclesOk) {
        throw new Error(
          "verify_evaluate blocked: run_oracles failed one or more verification_targets for run plan(s)"
        );
      }
    }
    if (verdict === VerifyVerdict.PASS) {
      this._reconcileRunTasksBeforeVerifyPass(run, {
        planIds: partialCheckpoint ? checkpoint.substantive_plan_ids : run.plan_ids
      });
    }
    if (partialCheckpoint) {
      content.verify_gate = {
        ...(content.verify_gate && typeof content.verify_gate === "object" ? content.verify_gate : {}),
        partial_mission: true,
        open_plans: checkpoint.open_plans,
        substantive_plan_ids: checkpoint.substantive_plan_ids,
        substantive_count: checkpoint.substantive_count,
        open_count: checkpoint.open_count
      };
    }
    const evidence = this._insertEvidence({
      mission_id: run.mission_id,
      run_id: run.id,
      type: "verification",
      source: "verify.evaluate",
      result: verdict,
      artifact_ref: run.id,
      content
    });

    const verifyTasks = this._listRunTasks(run.id).filter((task) =>
      task.payload?.stage_kind === StageKind.VERIFY_GATE &&
      [TASK_QUEUED, TASK_INPUT_REQUIRED, TASK_PAUSED].includes(task.status)
    );

    // In a partial checkpoint, only verify-gate tasks whose plan has substantive
    // roi:go evidence may be completed. Tasks for plans that still owe roi:go
    // must stay open, otherwise a partial pass would silently close the gate for
    // unverified plans (lifecycle gate bypass).
    const completableVerifyTasks = partialCheckpoint
      ? verifyTasks.filter((task) =>
          checkpoint.substantive_plan_ids.includes(task.plan_id)
        )
      : verifyTasks;

    if (completableVerifyTasks.length === 0) {
      if (verdict === VerifyVerdict.PASS && !partialCheckpoint) {
        return this._finalizeRunIfDoneAfterFullVerifyPass(run.id, {
          status: "ok",
          summary: `Review ${verdict}`,
          evidence,
          verdict
        });
      }
      return mutation({
        status: "ok",
        summary: `Review ${verdict}`,
        next_actions: verifyGateNextActions(verdict, { partialCheckpoint })
      }, { run, evidence, verdict });
    }

    const reviews = [];
    for (const task of completableVerifyTasks) {
      const activationId = task.payload?.activation_id || "";
      const review = this._insertReviewRecord({
        mission_id: run.mission_id,
        run_id: run.id,
        task_id: task.id,
        activation_id: activationId,
        review_type: StageKind.VERIFY_GATE,
        subject_ref: run.id,
        verdict,
        blocking_issues: verdict === VerifyVerdict.PASS ? [] : [`verification_${verdict}`],
        evidence_refs: [evidence.id],
        trace_refs: []
      });
      reviews.push(review);
      if (verdict === VerifyVerdict.PASS) {
        this._updateTask({ ...task, status: TASK_COMPLETED, blocking_reason: "" });
      } else {
        this._updateTask({ ...task, status: TASK_PAUSED, blocking_reason: `verification_${verdict}` });
      }
      if (activationId) {
        const activation = this._getActivation(activationId);
        this._updateActivation({
          ...activation,
          status: verdict === VerifyVerdict.PASS ? RUN_RUNNING : RUN_PAUSED
        });
      }
    }

    let updatedRun = this._getRun(run.id);
    updatedRun = this._appendRunRefs(updatedRun, [], [], reviews.map((review) => review.id));
    if (verdict !== VerifyVerdict.PASS) {
      updatedRun = this._updateRun({
        ...updatedRun,
        status: RUN_PAUSED,
        summary: `Review ${verdict}`
      });
      return mutation({
        status: "ok",
        summary: `Review ${verdict}`,
        next_actions: verifyGateNextActions(verdict, { partialCheckpoint })
      }, { run: updatedRun, evidence, reviews, verdict });
    }

    if (partialCheckpoint) {
      updatedRun = this._updateRun({
        ...updatedRun,
        status: RUN_PAUSED,
        summary: "Verify checkpoint pass (partial mission — roi:go still owed)"
      });
      return mutation(
        {
          status: "ok",
          summary: "Review pass (partial checkpoint)",
          next_actions: verifyGateNextActions(verdict, { partialCheckpoint: true }),
          partial_verification_checkpoint: true
        },
        { run: updatedRun, evidence, reviews, verdict }
      );
    }

    return this._finalizeRunIfDoneAfterFullVerifyPass(run.id, {
      status: "ok",
      summary: `Review ${verdict}`,
      evidence,
      reviews,
      verdict
    });
  }

  patternDetect({ mission_id }) {
    this._getMission(mission_id);
    const activations = this.activationList({ mission_id }).activations;
    const routeDecisions = this.routeList({ mission_id }).routing_decisions;
    const reviews = this.reviewList({ mission_id }).reviews;
    const grouped = new Map();

    for (const activation of activations) {
      const activationReviews = reviews.filter((review) => review.activation_id === activation.id);
      const allPass = activationReviews.length > 0 && activationReviews.every((review) => review.verdict === ReviewVerdict.PASS);
      if (!allPass || activation.status !== RUN_COMPLETED) {
        continue;
      }
      const routeCount = routeDecisions.filter((decision) => decision.capability_id === activation.capability_id).length;
      const existing = grouped.get(activation.capability_id) || {
        capability_id: activation.capability_id,
        frequency: 0,
        detected_in: [],
        review_refs: [],
        route_count: routeCount
      };
      existing.frequency += 1;
      existing.detected_in.push(activation.id);
      existing.review_refs.push(...activationReviews.map((review) => review.id));
      grouped.set(activation.capability_id, existing);
    }

    const patterns = [];
    for (const entry of grouped.values()) {
      if (entry.frequency < 3) {
        continue;
      }
      const existing = this.patternList({ mission_id }).patterns.find((pattern) => pattern.signature === `activation-success:${entry.capability_id}`);
      patterns.push(this._insertOrUpdatePattern({
        id: existing?.id || newId("pattern"),
        mission_id,
        signature: `activation-success:${entry.capability_id}`,
        evidence_refs: unique(entry.review_refs),
        frequency: entry.frequency,
        detected_in: unique(entry.detected_in),
        proposed_action: "capability.propose",
        promotion_target: "workflow",
        status: PatternStatus.PROPOSED
      }));
    }

    if (patterns.length === 0) {
      return mutation({ status: "noop", summary: "No completed workflow pattern is eligible for promotion" }, { patterns: [] });
    }
    return mutation({ status: "ok", summary: "Patterns detected", next_actions: ["roi:learn"] }, { patterns });
  }

  patternList({ mission_id }) {
    const rows = this._stmts.patterns_list_by_mission.all(mission_id);
    return { patterns: rows.map((row) => parseRowJson(row.data_json, "entity")) };
  }

  enlightenRun({ mission_id }) {
    const detected = this.patternDetect({ mission_id });
    if (!detected.patterns?.length) {
      return mutation({ status: "noop", summary: "No reusable pattern detected" }, { patterns: [], capabilities: [] });
    }

    const capabilities = [];
    for (const pattern of detected.patterns) {
      const sourceCapabilityId = pattern.signature.replace("activation-success:", "");
      const sourceCapability = this._getLatestCapability(sourceCapabilityId);
      const existingProposal = this.capabilityList({ mission_id }).capabilities.find((capability) =>
        capability.status === CapabilityStatus.PROPOSED &&
        capability.payload?.source_capability_id === sourceCapabilityId
      );
      if (existingProposal) {
        capabilities.push(existingProposal);
        continue;
      }
      capabilities.push(this.capabilityPropose({
        mission_id,
        name: `Enlightenment: ${sourceCapability.name}`,
        type: sourceCapability.type,
        triggers: sourceCapability.triggers,
        inputs: sourceCapability.inputs,
        outputs: sourceCapability.outputs,
        protocols: sourceCapability.protocols,
        policy_scope: "human-gated",
        matchers: sourceCapability.matchers,
        workflow_template: sourceCapability.workflow_template,
        review_policy_refs: sourceCapability.review_policy_refs,
        executor_modes: sourceCapability.executor_modes,
        promotion_source: CapabilityPromotionSource.ENLIGHTEN_PROPOSED,
        usage_count: pattern.frequency,
        effectiveness_score: pattern.frequency,
        payload: {
          pattern_id: pattern.id,
          source_capability_id: sourceCapabilityId
        }
      }).capability);
    }

    const convergence_learning = this._applyConvergenceLearningHints(mission_id, detected.patterns);

    return mutation({ status: "ok", summary: "Learning complete", next_actions: ["capability.promote", "roi:inspect"] }, {
      patterns: detected.patterns,
      capabilities,
      convergence_learning
    });
  }

  statusGet({ mission_id }) {
    const mission = this._getMission(mission_id);
    const runs = this.runList({ mission_id }).runs;
    const tasks = this.taskList({ mission_id }).tasks;
    const reviews = this.reviewList({ mission_id }).reviews;
    const activations = this.activationList({ mission_id }).activations;
    const routingDecisions = this.routeList({ mission_id }).routing_decisions;
    const capabilities = this.capabilityList({ mission_id }).capabilities;
    const traceCount = Number(
      this._stmts.traces_count_by_mission.get(mission_id)?.n ?? 0
    );
    const evidenceCount = Number(
      this._stmts.evidence_count_by_mission.get(mission_id)?.n ?? 0
    );

    const convergence = this._buildConvergenceSummary(mission_id);
    const brief = this._getLatestBrief(mission_id);

    return {
      summary: {
        mission,
        brief,
        verification_policy: missionVerificationPolicyFromBrief(brief),
        requires_helper_verified_proof: missionRequiresHelperVerifiedProof(brief),
        plans: this._listLatestPlans(mission_id),
        tasks,
        runs,
        policy_decisions: this._listPolicyDecisions(mission_id),
        routing_decisions: routingDecisions,
        capability_activations: activations,
        review_records: reviews,
        trace_count: traceCount,
        evidence_count: evidenceCount,
        patterns: this.patternList({ mission_id }).patterns,
        capability_proposals: capabilities.filter((capability) => capability.status === CapabilityStatus.PROPOSED),
        blocking_issues: this._activeBlockingIssues(mission_id, reviews),
        learning_readiness: this._enlightenmentReadiness(mission_id),
        convergence,
        mission_go_progress: this._missionGoProgress(mission_id),
        partial_verification_eligible: this._partialVerificationEligible(mission_id),
        implementation_proof_trust: this._missionImplementationProofTrust(mission_id),
        next_actions: this._nextActions(mission_id)
      }
    };
  }

  async _advanceRun(runId, input) {
    let run = this._getRun(runId);
    if (run.status !== RUN_RUNNING) {
      run = this._updateRun({ ...run, status: RUN_RUNNING, summary: "Workflow advancing" });
    }

    // Fetch task list once; patch updated tasks in-place to avoid a DB round-trip on
    // every iteration. Re-fetch only after _executeImplementStage, which may append
    // evidence/traces and update run refs (tasks themselves are not created mid-loop).
    let tasks = this._listRunTasks(run.id);

    while (true) {
      const missionEvidence = this.evidenceList({ mission_id: run.mission_id }).evidence;
      let requeuedReview = false;
      for (const task of tasks) {
        if (task.status !== TASK_PAUSED) {
          continue;
        }
        const stageKind = task.payload?.stage_kind;
        if (stageKind !== StageKind.SPEC_REVIEW && stageKind !== StageKind.QUALITY_REVIEW) {
          continue;
        }
        const plans = this._listLatestPlans(run.mission_id);
        if (!substantiveRoiGoForPlan(missionEvidence, task.plan_id, plans)) {
          continue;
        }
        this._updateTask({ ...task, status: TASK_QUEUED, blocking_reason: "" });
        requeuedReview = true;
      }
      if (requeuedReview) {
        run = this._updateRun({
          ...run,
          status: RUN_RUNNING,
          summary: "Workflow advancing (roi:go proof reconciled)"
        });
        tasks = this._listRunTasks(run.id);
        continue;
      }

      const resumableExternalTask = tasks.find((task) =>
        task.payload?.stage_kind === StageKind.IMPLEMENT &&
        [TASK_WAITING, TASK_AUTH_REQUIRED, TASK_INPUT_REQUIRED].includes(task.status)
      );

      if (resumableExternalTask) {
        const result = await this._executeImplementStage(run.id, resumableExternalTask, input);
        if (result.status !== "ok") {
          return result;
        }
        run = this._getRun(run.id);
        tasks = this._listRunTasks(run.id);
        continue;
      }

      const readyTask = tasks.find((task) => this._isTaskReady(task, tasks));

      if (!readyTask) {
        return this._finalizeRunIfDone(run.id);
      }

      if (readyTask.payload?.stage_kind === StageKind.IMPLEMENT) {
        const result = await this._executeImplementStage(run.id, readyTask, input);
        if (result.status !== "ok") {
          return result;
        }
        run = this._getRun(run.id);
        tasks = this._listRunTasks(run.id);
      } else if (readyTask.payload?.stage_kind === StageKind.VERIFY_GATE) {
        const task = this._updateTask({
          ...readyTask,
          status: TASK_INPUT_REQUIRED,
          blocking_reason: "awaiting_verification"
        });
        const activation = this._getActivation(task.payload.activation_id);
        this._updateActivation({ ...activation, status: RUN_PAUSED });
        const updatedRun = this._updateRun({
          ...this._getRun(run.id),
          status: RUN_PAUSED,
          summary: "Awaiting review"
        });
        return mutation({ status: "paused", summary: "Awaiting review", next_actions: ["roi:review"] }, { run: updatedRun, task });
      } else {
        const result = this._executeReviewStage(run.id, readyTask);
        if (result.status !== "ok") {
          return result;
        }
        // _executeReviewStage only updates task status; patch in-place without re-fetching.
        tasks = tasks.map((t) => (t.id === readyTask.id ? result.task ?? t : t));
      }

      run = this._getRun(run.id);
    }
  }

  async _executeImplementStage(runId, task, input) {
    const run = this._getRun(runId);
    const startedTask = this._updateTask({ ...task, status: TASK_RUNNING, blocking_reason: "" });
    const activation = this._getActivation(startedTask.payload.activation_id);
    this._updateActivation({ ...activation, status: RUN_RUNNING });
    const plan = this._getLatestPlan(startedTask.plan_id);
    const subject = input.prompt?.trim() || input.a2a_message?.trim() || startedTask.payload?.prompt || plan.actions.join(" ");
    const policyDecision = this._insertPolicyDecision(this.policyEvaluator({
      mission_id: run.mission_id,
      run_id: run.id,
      task_id: startedTask.id,
      subject,
      mode: startedTask.payload.executor_mode || "local"
    }));

    if (policyDecision.decision !== "allow") {
      const blockedTask = this._updateTask({
        ...startedTask,
        status: TASK_APPROVAL_REQUIRED,
        blocking_reason: policyDecision.reason
      });
      this._updateActivation({ ...activation, status: RUN_BLOCKED });
      const trace = this._insertTrace({
        mission_id: run.mission_id,
        run_id: run.id,
        task_id: blockedTask.id,
        events: ["policy_preflight_denied"],
        tool_calls: [],
        latency_ms: 0,
        token_usage: {},
        error_signals: ["policy_denied"],
        evaluation_refs: [policyDecision.id]
      });
      const blockedRun = this._appendRunRefs(
        this._updateRun({
          ...run,
          status: RUN_BLOCKED,
          summary: policyDecision.reason
        }),
        [trace.id]
      );
        return mutation({
          status: "blocked",
          summary: "Run blocked by policy",
          trace_refs: [trace.id],
          next_actions: ["roi:inspect"],
          failure_reason: policyDecision.reason
        }, { run: blockedRun, task: blockedTask, policy_decision: policyDecision, trace });
    }

    const executorMode = startedTask.payload.executor_mode || "local";
    if (executorMode === "a2a") {
      return this._executeImplementA2A(run, startedTask, plan, activation, input);
    }
    if (executorMode === "agent") {
      return this._executeImplementAgent(run, startedTask, plan, activation, input);
    }
    return this._executeImplementLocal(run, startedTask, plan, activation, input);
  }

  _executeImplementAgent(run, task, plan, activation, input) {
    const missionEvidence = this.evidenceList({ mission_id: run.mission_id }).evidence;
    const plans = this._listLatestPlans(run.mission_id);
    if (substantiveRoiGoForPlan(missionEvidence, plan.id, plans)) {
      return this._completeAgentImplementFromGo(run, task, plan, activation, missionEvidence);
    }

    if (
      task.status === TASK_INPUT_REQUIRED &&
      task.blocking_reason === "awaiting_host_implementation"
    ) {
      const pausedRun = this._updateRun({
        ...run,
        status: RUN_PAUSED,
        summary: "Awaiting host implementation (roi:go)"
      });
      return mutation(
        {
          status: "paused",
          summary: "Awaiting host implementation (roi:go)",
          next_actions: ["roi:go", "roi:inspect"]
        },
        { run: pausedRun, task }
      );
    }

    try {
      const prompt = input.prompt?.trim() || task.payload?.prompt || "";
      const output = this.agentExecutor.execute({
        prompt,
        missionId: run.mission_id,
        runId: run.id,
        planId: plan.id,
        actions: plan.actions ?? [],
        verificationTargets: plan.verification_targets ?? []
      });
      const evidence = this._insertEvidence({
        mission_id: run.mission_id,
        run_id: run.id,
        type: "execution_output",
        source: "host_agent_executor",
        result: "handoff",
        artifact_ref: task.id,
        content: {
          output,
          implement_mode: "host_agent",
          handoff: true,
          plan_id: plan.id,
          capability_id: activation.capability_id,
          declared_verification_targets: plan.verification_targets,
          next_action: "roi:go"
        }
      });
      const trace = this._insertTrace({
        mission_id: run.mission_id,
        run_id: run.id,
        task_id: task.id,
        events: ["agent_implement_handoff"],
        tool_calls: [],
        latency_ms: 0,
        token_usage: {},
        error_signals: [],
        evaluation_refs: [evidence.id]
      });
      const pausedTask = this._updateTask({
        ...task,
        status: TASK_INPUT_REQUIRED,
        blocking_reason: "awaiting_host_implementation"
      });
      this._updateActivation({ ...activation, status: RUN_PAUSED });
      const pausedRun = this._appendRunRefs(
        this._updateRun({
          ...run,
          status: RUN_PAUSED,
          summary: "Awaiting host implementation (roi:go)"
        }),
        [trace.id]
      );
      return mutation(
        {
          status: "paused",
          summary: "Implement stage handed off to host (roi:go)",
          next_actions: ["roi:go", "roi:inspect"],
          trace_refs: [trace.id]
        },
        { run: pausedRun, task: pausedTask, evidence, trace }
      );
    } catch (error) {
      const failedTask = this._updateTask({
        ...task,
        status: TASK_FAILED,
        blocking_reason: String(error.message || error)
      });
      this._updateActivation({ ...activation, status: RUN_FAILED });
      const failedRun = this._updateRun({
        ...run,
        status: RUN_FAILED,
        summary: String(error.message || error),
        ended_at: this.now().toISOString()
      });
      return mutation(
        {
          status: "error",
          summary: "Agent implement handoff failed",
          next_actions: ["roi:inspect"],
          failure_reason: String(error.message || error)
        },
        { run: failedRun, task: failedTask }
      );
    }
  }

  _completeAgentImplementFromGo(run, task, plan, activation, missionEvidence) {
    const goEvidence = latestRoiGoVerificationByPlan(missionEvidence).get(plan.id);
    return this._completeImplementTaskFromGo(run, task, plan, activation, goEvidence, {
      outputPrefix: "HOST_IMPLEMENT_COMPLETED",
      source: "host_agent_executor",
      events: ["agent_implement_completed_via_roi_go"],
      implementMode: "host_agent"
    });
  }

  _completeImplementTaskFromGo(run, task, plan, activation, goEvidence, options = {}) {
    if (!goEvidence?.id) {
      throw new Error(`verify_evaluate(pass) blocked: plan ${plan.id} lacks substantive roi:go evidence`);
    }
    const outputPrefix = options.outputPrefix || "IMPLEMENT_COMPLETED_FROM_ROI_GO";
    const output = `${outputPrefix}\nroi:go evidence ${goEvidence.id}`;
    const evidence = this._insertEvidence({
      mission_id: run.mission_id,
      run_id: run.id,
      type: "execution_output",
      source: options.source || "roi_go_reconciler",
      result: "completed",
      artifact_ref: task.id,
      content: {
        output,
        implement_mode: options.implementMode || "roi_go_reconciler",
        host_completed: true,
        roi_go_evidence_id: goEvidence.id,
        plan_id: plan.id,
        capability_id: activation.capability_id,
        declared_verification_targets: plan.verification_targets
      }
    });
    const trace = this._insertTrace({
      mission_id: run.mission_id,
      run_id: run.id,
      task_id: task.id,
      events: options.events || ["implement_reconciled_from_roi_go"],
      tool_calls: [],
      latency_ms: 0,
      token_usage: {},
      error_signals: [],
      evaluation_refs: [evidence.id, goEvidence.id]
    });
    const completedTask = this._updateTask({
      ...task,
      status: TASK_COMPLETED,
      blocking_reason: ""
    });
    this._updateActivation({ ...activation, status: RUN_RUNNING });
    this._appendRunRefs(this._getRun(run.id), [trace.id], [], []);
    this._appendRunDeliverable(run.id, evidence.id);
    return mutation(
      { status: "ok", summary: "Implement stage completed via roi:go" },
      { run: this._getRun(run.id), task: completedTask, evidence, trace }
    );
  }

  _executeImplementLocal(run, task, plan, activation, input) {
    try {
      const prompt = input.prompt?.trim() || task.payload?.prompt || "";
      const output = this.localExecutor.execute({ prompt, missionId: run.mission_id, runId: run.id });
      const traceErrorSignals = prompt.includes("UNVERIFIED_COMPLETION_CLAIM") ? ["unverified_completion_claim"] : [];
      const evidence = this._insertEvidence({
        mission_id: run.mission_id,
        run_id: run.id,
        type: "execution_output",
        source: "local_executor",
        result: "completed",
        artifact_ref: task.id,
        content: {
          output,
          plan_id: plan.id,
          capability_id: activation.capability_id,
          declared_verification_targets: plan.verification_targets
        }
      });
      const trace = this._insertTrace({
        mission_id: run.mission_id,
        run_id: run.id,
        task_id: task.id,
        events: ["local_execution_started", "local_execution_completed"],
        tool_calls: [],
        latency_ms: 0,
        token_usage: {},
        error_signals: traceErrorSignals,
        evaluation_refs: [evidence.id]
      });
      const completedTask = this._updateTask({ ...task, status: TASK_COMPLETED });
      this._updateActivation({ ...activation, status: RUN_RUNNING });
      this._appendRunRefs(this._getRun(run.id), [trace.id], [], []);
      this._appendRunDeliverable(run.id, evidence.id);
      return mutation({ status: "ok", summary: "Implement stage completed" }, { run: this._getRun(run.id), task: completedTask, evidence, trace });
    } catch (error) {
      const trace = this._insertTrace({
        mission_id: run.mission_id,
        run_id: run.id,
        task_id: task.id,
        events: ["local_execution_failed"],
        tool_calls: [],
        latency_ms: 0,
        token_usage: {},
        error_signals: [String(error.message || error)],
        evaluation_refs: []
      });
      const failedTask = this._updateTask({ ...task, status: TASK_FAILED, blocking_reason: String(error.message || error) });
      this._updateActivation({ ...activation, status: RUN_FAILED });
      const failedRun = this._appendRunRefs(
        this._updateRun({
          ...run,
          status: RUN_FAILED,
          summary: String(error.message || error),
          ended_at: this.now().toISOString()
        }),
        [trace.id]
      );
      return mutation({
        status: "error",
        summary: "Local run failed",
        trace_refs: [trace.id],
        next_actions: ["roi:inspect"],
        failure_reason: String(error.message || error)
      }, { run: failedRun, task: failedTask, trace });
    }
  }

  async _executeImplementA2A(run, task, plan, activation, input) {
    const existingBinding = this.protocolListBindings({ task_id: task.id }).protocol_bindings[0];
    const binding = existingBinding || this._insertProtocolBinding({
      mission_id: run.mission_id,
      run_id: run.id,
      task_id: task.id,
      protocol: "a2a",
      endpoint: input.a2a_agent_card_url?.trim() || task.payload?.a2a_agent_card_url || "",
      auth_mode: "agent-card",
      artifact_contract: "task-scoped-result",
      status: "submitted",
      payload: {}
    });

    try {
      const result = await this.a2aExecutor.invoke({
        agentCardUrl: binding.endpoint,
        taskId: existingBinding?.payload?.remote_task_id || input.remote_task_id?.trim() || "",
        contextId: existingBinding?.payload?.remote_context_id || input.remote_context_id?.trim() || "",
        message: input.a2a_message?.trim() || task.payload?.prompt || ""
      });
      const mapped = mapA2AState(result.state);
      const updatedBinding = this._updateProtocolBinding({
        ...binding,
        status: mapped.run_status,
        payload: {
          remote_task_id: result.taskId || "",
          remote_context_id: result.contextId || "",
          state: result.state || "",
          text: result.text || "",
          artifacts: result.artifacts || []
        }
      });
      const trace = this._insertTrace({
        mission_id: run.mission_id,
        run_id: run.id,
        task_id: task.id,
        events: ["a2a_invoked", `a2a_${mapped.task_status}`],
        tool_calls: [],
        latency_ms: 0,
        token_usage: {},
        error_signals: mapped.run_status === RUN_FAILED ? [result.errorMessage || "remote_failure"] : [],
        evaluation_refs: [updatedBinding.id]
      });
      const evidence = this._insertEvidence({
        mission_id: run.mission_id,
        run_id: run.id,
        type: "a2a_result",
        source: "a2a",
        result: mapped.task_status,
        artifact_ref: task.id,
        content: {
          text: result.text || "",
          task_id: result.taskId || "",
          context_id: result.contextId || "",
          artifacts: result.artifacts || [],
          plan_id: plan.id,
          capability_id: activation.capability_id,
          declared_verification_targets: plan.verification_targets
        }
      });
      const updatedTask = this._updateTask({
        ...task,
        status: mapped.task_status,
        blocking_reason: mapped.blocking_reason
      });
      this._appendRunRefs(this._getRun(run.id), [trace.id], [updatedBinding.id], []);
      this._appendRunDeliverable(run.id, evidence.id);

      if (!mapped.final) {
        this._updateActivation({ ...activation, status: RUN_PAUSED });
        const pausedRun = this._updateRun({
          ...this._getRun(run.id),
          status: RUN_PAUSED,
          summary: "A2A run awaiting follow-up"
        });
        return mutation({ status: "paused", summary: "A2A run awaiting follow-up", next_actions: ["roi:draft"] }, {
          run: pausedRun,
          task: updatedTask,
          evidence,
          trace,
          protocol_binding: updatedBinding
        });
      }

      if (mapped.run_status === RUN_FAILED) {
        this._updateActivation({ ...activation, status: RUN_FAILED });
        const failedRun = this._updateRun({
          ...this._getRun(run.id),
          status: RUN_FAILED,
          summary: result.errorMessage || "remote_failure",
          ended_at: this.now().toISOString()
        });
        return mutation({
          status: "error",
          summary: "A2A run failed",
          trace_refs: [trace.id],
          next_actions: ["roi:inspect"],
          failure_reason: result.errorMessage || "remote_failure"
        }, { run: failedRun, task: updatedTask, protocol_binding: updatedBinding, evidence, trace });
      }

      this._updateActivation({ ...activation, status: RUN_RUNNING });
      return mutation({ status: "ok", summary: "Implement stage completed" }, {
        run: this._getRun(run.id),
        task: updatedTask,
        protocol_binding: updatedBinding,
        evidence,
        trace
      });
    } catch (error) {
      const trace = this._insertTrace({
        mission_id: run.mission_id,
        run_id: run.id,
        task_id: task.id,
        events: ["a2a_invocation_failed"],
        tool_calls: [],
        latency_ms: 0,
        token_usage: {},
        error_signals: [String(error.message || error)],
        evaluation_refs: [binding.id]
      });
      const failedTask = this._updateTask({ ...task, status: TASK_FAILED, blocking_reason: String(error.message || error) });
      this._updateActivation({ ...activation, status: RUN_FAILED });
      const failedRun = this._appendRunRefs(
        this._updateRun({
          ...run,
          status: RUN_FAILED,
          summary: String(error.message || error),
          ended_at: this.now().toISOString()
        }),
        [trace.id],
        [binding.id]
      );
      return mutation({
        status: "error",
        summary: "A2A run failed",
        trace_refs: [trace.id],
        next_actions: ["roi:inspect"],
        failure_reason: String(error.message || error)
      }, { run: failedRun, task: failedTask, protocol_binding: binding, trace });
    }
  }

  _executeReviewStage(runId, task) {
    const run = this._getRun(runId);
    const startedTask = this._updateTask({ ...task, status: TASK_RUNNING, blocking_reason: "" });
    const review = this._evaluateReviewPack(run, startedTask);
    const record = this._insertReviewRecord({
      mission_id: run.mission_id,
      run_id: run.id,
      task_id: startedTask.id,
      activation_id: startedTask.payload.activation_id,
      review_type: startedTask.payload.stage_kind,
      subject_ref: review.subject_ref,
      verdict: review.verdict,
      blocking_issues: review.blocking_issues,
      evidence_refs: review.evidence_refs,
      trace_refs: review.trace_refs
    });

    const updatedRunWithReview = this._appendRunRefs(run, [], [], [record.id]);
    if (review.verdict !== ReviewVerdict.PASS) {
      const pausedTask = this._updateTask({
        ...startedTask,
        status: TASK_PAUSED,
        blocking_reason: review.blocking_issues.join("; ")
      });
      const activation = this._getActivation(startedTask.payload.activation_id);
      this._updateActivation({ ...activation, status: RUN_PAUSED });
      const pausedRun = this._updateRun({
        ...updatedRunWithReview,
        status: RUN_PAUSED,
        summary: `${startedTask.payload.stage_kind} blocked`
      });
      const needsGo = missionNeedsRoiGo(
        this._listLatestPlans(run.mission_id),
        this.evidenceList({ mission_id: run.mission_id }).evidence
      );
      const reviewNext = pausedRunNextActions({
        needsGo:
          needsGo || review.blocking_issues.includes("local_implement_stub_only")
      });
      return mutation({ status: "paused", summary: `${startedTask.payload.stage_kind} blocked`, next_actions: reviewNext }, {
        run: pausedRun,
        task: pausedTask,
        review: record
      });
    }

    const completedTask = this._updateTask({ ...startedTask, status: TASK_COMPLETED, blocking_reason: "" });
    return mutation({ status: "ok", summary: `${startedTask.payload.stage_kind} passed` }, {
      run: updatedRunWithReview,
      task: completedTask,
      review: record
    });
  }

  _evaluateReviewPack(run, task) {
    const activationId = task.payload.activation_id;
    const stageKind = task.payload.stage_kind;
    const plan = this._getLatestPlan(task.plan_id);
    const activationTasks = this._listRunTasks(run.id).filter((candidate) => candidate.payload?.activation_id === activationId);
    const implementTask = activationTasks.find((candidate) => candidate.payload?.stage_kind === StageKind.IMPLEMENT);
    const evidence = implementTask
      ? this.evidenceList({ mission_id: run.mission_id, run_id: run.id }).evidence.find((item) => item.artifact_ref === implementTask.id)
      : null;
    const traces = implementTask
      ? this.traceList({ mission_id: run.mission_id, run_id: run.id }).traces.filter((trace) => trace.task_id === implementTask.id)
      : [];
    const latestTrace = traces[0] || null;
    const policyDenials = this._listPolicyDecisions(run.mission_id).filter((decision) => decision.run_id === run.id && decision.decision === "deny");

    const missionEvidence = this.evidenceList({ mission_id: run.mission_id }).evidence;
    const plans = this._listLatestPlans(run.mission_id);
    const roiGoSatisfied = substantiveRoiGoForPlan(missionEvidence, plan.id, plans);

    if (stageKind === StageKind.SPEC_REVIEW) {
      const blockingIssues = [];
      if (!implementTask || implementTask.status !== TASK_COMPLETED) {
        blockingIssues.push("implement_stage_not_completed");
      }
      if (!evidence) {
        blockingIssues.push("missing_execution_evidence");
      }
      if (!plan.verification_targets.length) {
        blockingIssues.push("missing_verification_targets");
      }
      if (evidence && !Array.isArray(evidence.content?.declared_verification_targets)) {
        blockingIssues.push("verification_targets_not_represented");
      }
      if (
        evidence &&
        isLocalImplementStubOutput(evidence.content?.output) &&
        process.env.ROI_ALLOW_LOCAL_STUB !== "1"
      ) {
        blockingIssues.push("local_implement_stub_only");
      }
      const effectiveIssues = filterReviewBlockingIssues(blockingIssues, { roiGoSatisfied });
      return {
        subject_ref: implementTask?.id || task.id,
        verdict: effectiveIssues.length ? ReviewVerdict.FAIL : ReviewVerdict.PASS,
        blocking_issues: effectiveIssues,
        evidence_refs: evidence ? [evidence.id] : [],
        trace_refs: latestTrace ? [latestTrace.id] : []
      };
    }

    if (stageKind === StageKind.QUALITY_REVIEW) {
      const blockingIssues = [];
      if (policyDenials.length > 0) {
        blockingIssues.push("policy_denial_detected");
      }
      if (latestTrace?.error_signals?.length) {
        blockingIssues.push(...latestTrace.error_signals);
      }
      if ((evidence?.content?.output || "").includes("UNVERIFIED_COMPLETION_CLAIM")) {
        blockingIssues.push("verification_evidence_missing_before_completion_claim");
      }
      if (
        evidence &&
        isLocalImplementStubOutput(evidence.content?.output) &&
        process.env.ROI_ALLOW_LOCAL_STUB !== "1"
      ) {
        blockingIssues.push("local_implement_stub_only");
      }
      const effectiveIssues = filterReviewBlockingIssues(blockingIssues, { roiGoSatisfied });
      return {
        subject_ref: implementTask?.id || task.id,
        verdict: effectiveIssues.length ? ReviewVerdict.FAIL : ReviewVerdict.PASS,
        blocking_issues: unique(effectiveIssues),
        evidence_refs: evidence ? [evidence.id] : [],
        trace_refs: latestTrace ? [latestTrace.id] : []
      };
    }

    return {
      subject_ref: task.id,
      verdict: ReviewVerdict.PASS,
      blocking_issues: [],
      evidence_refs: [],
      trace_refs: []
    };
  }

  _finalizeRunIfDone(runId, basePayload = {}) {
    let run = this._getRun(runId);
    const tasks = this._listRunTasks(run.id);
    const allCompleted = tasks.length > 0 && tasks.every((task) => task.status === TASK_COMPLETED);
    if (allCompleted) {
      run = this._updateRun({
        ...run,
        status: RUN_COMPLETED,
        summary: basePayload.summary || run.summary || "Workflow completed",
        ended_at: this.now().toISOString()
      });
      for (const activation of this.activationList({ run_id: run.id }).activations) {
        this._updateActivation({ ...activation, status: RUN_COMPLETED });
      }
      return mutation({ status: basePayload.status || "ok", summary: basePayload.summary || "Run completed", next_actions: ["roi:publish", "roi:learn"] }, {
        ...basePayload,
        run
      });
    }

    const blockedTask = tasks.find((task) => [TASK_PAUSED, TASK_INPUT_REQUIRED, TASK_WAITING, TASK_APPROVAL_REQUIRED, TASK_AUTH_REQUIRED].includes(task.status));
    if (blockedTask) {
      const pausedStatus = blockedTask.status === TASK_APPROVAL_REQUIRED ? RUN_BLOCKED : RUN_PAUSED;
      run = this._updateRun({
        ...run,
        status: pausedStatus,
        summary: blockedTask.blocking_reason || run.summary
      });
      const needsGo = missionNeedsRoiGo(
        this._listLatestPlans(run.mission_id),
        this.evidenceList({ mission_id: run.mission_id }).evidence
      );
      return mutation(
        {
          status: basePayload.status || (pausedStatus === RUN_BLOCKED ? "blocked" : "paused"),
          summary: basePayload.summary || run.summary || "Run paused",
          next_actions: pausedRunNextActions({
            needsGo,
            blocked: pausedStatus === RUN_BLOCKED
          })
        },
        {
        ...basePayload,
        run,
        task: blockedTask
      });
    }

    run = this._updateRun({
      ...run,
      status: RUN_RUNNING,
      summary: run.summary || "Workflow in progress"
    });
    return mutation({ status: basePayload.status || "ok", summary: basePayload.summary || "Run in progress" }, {
      ...basePayload,
      run
    });
  }

  _finalizeRunIfDoneAfterFullVerifyPass(runId, basePayload = {}) {
    return this._finalizeRunIfDone(runId, basePayload);
  }

  _reconcileRunTasksBeforeVerifyPass(run, { planIds } = {}) {
    const planFilter = new Set((planIds ?? []).map((id) => String(id).trim()).filter(Boolean));
    const inPlanScope = (task) => !planFilter.size || planFilter.has(task.plan_id);
    const isOpen = (task) => [
      TASK_QUEUED,
      TASK_RUNNING,
      TASK_INPUT_REQUIRED,
      TASK_PAUSED,
      TASK_WAITING
    ].includes(task.status);

    while (true) {
      const tasks = this._listRunTasks(run.id);
      const openPreVerify = tasks.filter((task) =>
        inPlanScope(task) &&
        task.payload?.stage_kind !== StageKind.VERIFY_GATE &&
        isOpen(task)
      );
      if (!openPreVerify.length) {
        return;
      }

      let progressed = false;
      for (const task of openPreVerify) {
        if (!this._taskDependenciesCompleted(task, tasks)) {
          continue;
        }
        const plan = this._getLatestPlan(task.plan_id);
        const missionEvidence = this.evidenceList({ mission_id: run.mission_id }).evidence;
        if (!substantiveRoiGoForPlan(missionEvidence, plan.id, this._listLatestPlans(run.mission_id))) {
          continue;
        }
        const activation = this._getActivation(task.payload.activation_id);

        if (task.payload?.stage_kind === StageKind.IMPLEMENT) {
          const goEvidence = latestRoiGoVerificationByPlan(missionEvidence).get(plan.id);
          this._completeImplementTaskFromGo(run, task, plan, activation, goEvidence);
          progressed = true;
          continue;
        }

        if ([StageKind.SPEC_REVIEW, StageKind.QUALITY_REVIEW].includes(task.payload?.stage_kind)) {
          const result = this._executeReviewStage(run.id, task);
          if (result.status !== "ok") {
            throw new Error(
              `verify_evaluate(pass) blocked: ${task.payload.stage_kind} did not pass for plan ${plan.id}`
            );
          }
          progressed = true;
        }
      }

      if (!progressed) {
        const blocked = openPreVerify
          .map((task) => `${task.payload?.stage_kind || task.kind}:${task.plan_id}:${task.status}`)
          .join(", ");
        throw new Error(
          `verify_evaluate(pass) blocked: run has open pre-verify workflow task(s): ${blocked}`
        );
      }
    }
  }

  _taskDependenciesCompleted(task, tasks) {
    const deps = Array.isArray(task.payload?.depends_on_task_ids) ? task.payload.depends_on_task_ids : [];
    if (!deps.length) {
      return true;
    }
    const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
    return deps.every((depId) => byId.get(depId)?.status === TASK_COMPLETED);
  }

  _buildStageTasks({ mission, plan, run, activation, capability, contextPack, input, mode }) {
    const tasks = [];
    let dependsOnTaskIds = [];
    for (const stageKind of capability.workflow_template) {
      const task = this._insertTask({
        mission_id: mission.id,
        plan_id: plan.id,
        run_id: run.id,
        kind: stageKind === StageKind.IMPLEMENT ? `${mode}_execution` : `${stageKind}_task`,
        status: TASK_QUEUED,
        assignee: input.assignee?.trim() || "",
        checkpoint_ref: "",
        retry_count: 0,
        blocking_reason: "",
        payload: {
          stage_kind: stageKind,
          depends_on_task_ids: dependsOnTaskIds,
          capability_id: capability.id,
          activation_id: activation.id,
          context_pack_id: contextPack.id,
          workflow_template_ref: capability.id,
          prompt: input.prompt || plan.actions.join("\n"),
          executor_mode: mode,
          a2a_agent_card_url: input.a2a_agent_card_url?.trim() || "",
          verification_targets: plan.verification_targets
        }
      });
      tasks.push(task);
      dependsOnTaskIds = [task.id];
    }
    return tasks;
  }

  _isTaskReady(task, tasks) {
    if (task.status !== TASK_QUEUED) {
      return false;
    }
    const deps = asArray(task.payload?.depends_on_task_ids);
    return deps.every((depId) => tasks.find((candidate) => candidate.id === depId)?.status === TASK_COMPLETED);
  }

  _matchCapability({ mission, brief, plan, mode }) {
    this._ensureBuiltinCapabilities();
    const haystack = compactJoin([
      mission.title,
      mission.goal,
      brief?.problem || "",
      plan?.name || "",
      plan?.scope || "",
      ...(plan?.actions || []),
      ...(brief?.assumptions || [])
    ]).toLowerCase();

    const candidates = this.capabilityList({ mission_id: mission.id }).capabilities
      .filter((capability) => capability.status === CapabilityStatus.PROMOTED)
      .map((capability) => {
        const matchers = capability.matchers || {};
        const missionKeywords = asArray(matchers.mission_keywords);
        const planActionKeywords = asArray(matchers.plan_action_keywords);
        let score = capability.id === DEFAULT_CAPABILITY_ID ? 0.1 : 0;
        const hits = [];
        for (const keyword of missionKeywords) {
          if (haystack.includes(keyword.toLowerCase())) {
            score += 1;
            hits.push(`mission:${keyword}`);
          }
        }
        for (const keyword of planActionKeywords) {
          if (haystack.includes(keyword.toLowerCase())) {
            score += 1;
            hits.push(`plan:${keyword}`);
          }
        }
        if (asExecutorModes(capability.executor_modes).includes(mode)) {
          score += 0.25;
          hits.push(`mode:${mode}`);
        }
        return {
          capability,
          score,
          hits
        };
      })
      .sort((left, right) => right.score - left.score || left.capability.name.localeCompare(right.capability.name));

    const selected = candidates[0] || { capability: this._getLatestCapability(DEFAULT_CAPABILITY_ID), score: 0.1, hits: ["fallback"] };
    return {
      capability: selected.capability,
      confidence: Number(selected.score.toFixed(2)),
      reason: selected.hits.length ? `matched ${selected.hits.join(", ")}` : "fallback capability selected",
      rejected_alternatives: candidates.slice(1, 4).map((candidate) => ({
        capability_id: candidate.capability.id,
        score: Number(candidate.score.toFixed(2)),
        hits: candidate.hits
      }))
    };
  }

  _resolveRoutingDecision({ mission, brief, plan, mode, persist }) {
    const matched = this._matchCapability({ mission, brief, plan, mode });
    const decision = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("route"),
      mission_id: mission.id,
      plan_id: plan?.id || "",
      capability_id: matched.capability.id,
      confidence: matched.confidence,
      reason: matched.reason,
      rejected_alternatives: matched.rejected_alternatives,
      created_at: this.now().toISOString()
    };
    if (persist) {
      this._insertRoutingDecision(decision);
    }
    return decision;
  }

  _decorateMission(mission) {
    const controller = this._getConvergenceController(mission.id);
    if (!controller) {
      return mission;
    }
    return {
      ...mission,
      convergence: {
        domain: controller.domain,
        current_maturity: controller.current_maturity,
        target_maturity: controller.target_maturity,
        maturity_ladder: controller.maturity_ladder,
        autonomy_mode: controller.autonomy_mode
      }
    };
  }

  _buildConvergenceController({ mission_id, title, goal, convergence }) {
    const ladder = unique(asArray(convergence?.maturity_ladder));
    const current = convergence?.current_maturity?.trim() || ladder[0] || "unscoped";
    const target = convergence?.target_maturity?.trim() || ladder.at(-1) || current;
    const now = this.now().toISOString();
    return {
      schema_version: ROI_SCHEMA_VERSION,
      mission_id,
      domain: convergence?.domain?.trim() || title || goal || mission_id,
      current_maturity: current,
      target_maturity: target,
      maturity_ladder: ladder.length ? ladder : [current, target].filter(Boolean),
      autonomy_mode: convergence?.autonomy_mode || "auto_low_judgment",
      state: CONVERGENCE_STATE_DRAFTING,
      active_seam_id: "",
      active_plan_id: "",
      state_reason: "",
      terminal_scope: CONVERGENCE_SCOPE_DECLARED_MANIFEST,
      election: {},
      publish_finalization: {},
      created_at: now,
      updated_at: now
    };
  }

  _mergeConvergenceController(current, { mission_id, title, goal, convergence }) {
    const base = current || this._buildConvergenceController({ mission_id, title, goal, convergence });
    const ladder = unique(asArray(convergence?.maturity_ladder).length ? asArray(convergence?.maturity_ladder) : base.maturity_ladder);
    return {
      ...base,
      domain: convergence?.domain?.trim() || base.domain,
      current_maturity: convergence?.current_maturity?.trim() || base.current_maturity,
      target_maturity: convergence?.target_maturity?.trim() || base.target_maturity,
      maturity_ladder: ladder,
      autonomy_mode: convergence?.autonomy_mode || base.autonomy_mode
    };
  }

  _getConvergenceController(missionId) {
    const row = this._stmts.convergence_ctrl_get.get(missionId);
    return row ? parseRowJson(row.data_json, "entity") : null;
  }

  _upsertConvergenceController(controller) {
    const updated = {
      ...controller,
      updated_at: this.now().toISOString()
    };
    this.db.prepare(`
      INSERT INTO convergence_controllers (mission_id, data_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(mission_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).run(updated.mission_id, json(updated), updated.updated_at);
    return updated;
  }

  _listConvergenceSeams(missionId) {
    const rows = this._stmts.convergence_seams_list.all(missionId);
    return rows.map((row) => parseRowJson(row.data_json, "entity"));
  }

  _getConvergenceSeam(seamId) {
    const row = this._stmts.convergence_seam_get.get(seamId);
    return row ? parseRowJson(row.data_json, "entity") : null;
  }

  _upsertConvergenceSeam(seam) {
    const updated = {
      ...seam,
      updated_at: this.now().toISOString()
    };
    this.db.prepare(`
      INSERT INTO convergence_seams (id, mission_id, data_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).run(updated.id, updated.mission_id, json(updated), updated.updated_at);
    return updated;
  }

  _generateConvergencePlans({ mission, brief, controller, input }) {
    const plans = [];
    const seams = [];
    for (const [index, seamInput] of asArray(input.seams).entries()) {
      const existing = seamInput.id ? this._getConvergenceSeam(seamInput.id) : null;
      const seamId = existing?.id || seamInput.id || newId("seam");
      const planDraft = seamInput.plan || {};
      const planId = existing?.plan_id || planDraft.id || newId("plan");
      const draftPlan = {
        id: planId,
        mission_id: mission.id,
        name: planDraft.name?.trim() || seamInput.title.trim(),
        scope: planDraft.scope?.trim() || seamInput.summary?.trim() || brief?.problem || mission.goal,
        inputs: asArray(planDraft.inputs),
        actions: asArray(planDraft.actions).length ? asArray(planDraft.actions) : [seamInput.summary?.trim() || seamInput.title.trim()],
        dependencies: asArray(planDraft.dependencies),
        verification_targets: asArray(planDraft.verification_targets),
        source_contract_refs: asArray(planDraft.source_contract_refs),
        requires_source_contract_check: Boolean(planDraft.requires_source_contract_check),
        status: planDraft.status?.trim() || "planned",
        wave: Number(planDraft.wave ?? index + 1),
        convergence_seam_id: seamId
      };
      const routing = this._resolveRoutingDecision({
        mission,
        brief,
        plan: draftPlan,
        mode: "local",
        persist: true
      });
      const capability = this._getLatestCapability(routing.capability_id);
      const plan = this._insertPlan({
        ...draftPlan,
        capability_id: capability.id,
        workflow_template_ref: capability.id,
        workflow_template: capability.workflow_template
      });
      const seam = this._upsertConvergenceSeam({
        schema_version: ROI_SCHEMA_VERSION,
        id: seamId,
        mission_id: mission.id,
        title: seamInput.title.trim(),
        summary: seamInput.summary?.trim() || "",
        expected_maturity_gain: Number(seamInput.expected_maturity_gain ?? 0),
        advances_to: seamInput.advances_to?.trim() || "",
        unlock_score: Number(seamInput.unlock_score ?? 0),
        evidence_confidence: Number(seamInput.evidence_confidence ?? 0),
        requires_judgment: Boolean(seamInput.requires_judgment),
        blocked_by: asArray(seamInput.blocked_by),
        manifest_order: Number(seamInput.manifest_order ?? index + 1),
        status: existing?.status === "delivered" ? "delivered" : "candidate",
        plan_id: plan.id,
        learned_adjustments: existing?.learned_adjustments || {},
        selection_reason: existing?.selection_reason || "",
        created_at: existing?.created_at || this.now().toISOString(),
        updated_at: this.now().toISOString()
      });
      plans.push(plan);
      seams.push(seam);
    }
    const updatedController = this._electConvergenceState(controller.mission_id);
    return {
      plans,
      seams: this._listConvergenceSeams(mission.id),
      controller: updatedController
    };
  }

  _scoreConvergenceSeam(seam) {
    const learnedDelta = Number(seam.learned_adjustments?.evidence_confidence_delta ?? 0);
    const effectiveEvidenceConfidence = Number(seam.evidence_confidence ?? 0) + learnedDelta;
    const score =
      Number(seam.expected_maturity_gain ?? 0) * 100 +
      Number(seam.unlock_score ?? 0) * 10 +
      effectiveEvidenceConfidence;
    return {
      expected_maturity_gain: Number(seam.expected_maturity_gain ?? 0),
      unlock_score: Number(seam.unlock_score ?? 0),
      evidence_confidence: Number(seam.evidence_confidence ?? 0),
      learned_evidence_confidence_delta: learnedDelta,
      effective_evidence_confidence: effectiveEvidenceConfidence,
      score: Number(score.toFixed(4))
    };
  }

  _electConvergenceState(missionId) {
    const controller = this._getConvergenceController(missionId);
    if (!controller) {
      return null;
    }
    const seams = this._listConvergenceSeams(missionId)
      .filter((seam) => seam.status !== "delivered")
      .map((seam) => ({
        seam,
        scoring: this._scoreConvergenceSeam(seam)
      }))
      .sort((left, right) =>
        right.scoring.score - left.scoring.score ||
        right.scoring.expected_maturity_gain - left.scoring.expected_maturity_gain ||
        Number(left.seam.requires_judgment) - Number(right.seam.requires_judgment) ||
        Number(left.seam.manifest_order ?? 0) - Number(right.seam.manifest_order ?? 0)
      );

    if (seams.length === 0) {
      const reachedTarget = controller.current_maturity === controller.target_maturity;
      return this._upsertConvergenceController({
        ...controller,
        state: reachedTarget ? CONVERGENCE_STATE_CONVERGED : CONVERGENCE_STATE_RESIDUAL_GAP,
        active_seam_id: "",
        active_plan_id: "",
        state_reason: reachedTarget
          ? "Declared manifest exhausted at target maturity"
          : "Declared manifest exhausted before target maturity",
        election: {}
      });
    }

    const selected = seams[0];
    const selectedSeam = selected.seam;
    const baseController = {
      ...controller,
      active_seam_id: selectedSeam.id,
      active_plan_id: selectedSeam.plan_id,
      election: {
        selected_seam_id: selectedSeam.id,
        rationale: `Selected ${selectedSeam.title}`,
        tie_break_reason:
          seams.length > 1 &&
          selected.scoring.score === seams[1].scoring.score &&
          selected.scoring.expected_maturity_gain === seams[1].scoring.expected_maturity_gain
            ? "manifest_order"
            : "score",
        scoring: selected.scoring
      }
    };

    if (asArray(selectedSeam.blocked_by).length > 0) {
      return this._upsertConvergenceController({
        ...baseController,
        state: CONVERGENCE_STATE_BLOCKED,
        state_reason: compactJoin(asArray(selectedSeam.blocked_by))
      });
    }
    if (selectedSeam.requires_judgment && controller.autonomy_mode === "auto_low_judgment") {
      return this._upsertConvergenceController({
        ...baseController,
        state: CONVERGENCE_STATE_PAUSED_FOR_JUDGMENT,
        state_reason: selectedSeam.summary || selectedSeam.title
      });
    }

    for (const seam of this._listConvergenceSeams(missionId)) {
      this._upsertConvergenceSeam({
        ...seam,
        status:
          seam.id === selectedSeam.id
            ? "active"
            : seam.status === "delivered"
              ? "delivered"
              : "candidate",
        selection_reason: seam.id === selectedSeam.id ? baseController.election.rationale : seam.selection_reason
      });
    }

    return this._upsertConvergenceController({
      ...baseController,
      state: CONVERGENCE_STATE_ACTIVE,
      state_reason: baseController.election.rationale
    });
  }

  _buildConvergenceSummary(missionId) {
    const controller = this._getConvergenceController(missionId);
    if (!controller) {
      return null;
    }
    const seams = this._listConvergenceSeams(missionId)
      .map((seam) => ({
        ...seam,
        scoring: this._scoreConvergenceSeam(seam)
      }))
      .sort((left, right) => Number(left.manifest_order ?? 0) - Number(right.manifest_order ?? 0));
    const activeSeam = seams.find((seam) => seam.id === controller.active_seam_id) || null;
    return {
      controller,
      active_seam: activeSeam,
      active_plan: controller.active_plan_id ? this._getLatestPlan(controller.active_plan_id) : null,
      seams,
      learned_adjustments: seams
        .filter((seam) => Object.keys(asObject(seam.learned_adjustments)).length > 0)
        .map((seam) => ({
          seam_id: seam.id,
          title: seam.title,
          learned_adjustments: seam.learned_adjustments
      }))
    };
  }

  _applyConvergenceLearningHints(missionId, patterns) {
    const controller = this._getConvergenceController(missionId);
    if (!controller || !patterns.length) {
      return [];
    }
    const remaining = this._listConvergenceSeams(missionId).filter((seam) => seam.status !== "delivered");
    if (!remaining.length) {
      return [];
    }
    const delta = Number(Math.min(0.25, patterns.length * 0.05).toFixed(2));
    return remaining.map((seam) => {
      const updated = this._upsertConvergenceSeam({
        ...seam,
        learned_adjustments: {
          ...asObject(seam.learned_adjustments),
          evidence_confidence_delta: delta,
          note: `learned from ${patterns.length} repeated successful pattern${patterns.length === 1 ? "" : "s"}`
        }
      });
      return {
        seam_id: updated.id,
        title: updated.title,
        learned_adjustments: updated.learned_adjustments
      };
    });
  }

  _finalizeConvergencePublication({ controller, run, run_id, evidence }) {
    if (!run && !run_id) {
      return this._buildConvergenceSummary(controller.mission_id);
    }
    const publishRun = run || this._getMissionRun(controller.mission_id, run_id);
    if (
      controller.publish_finalization?.run_id === publishRun.id &&
      controller.publish_finalization?.state === "finalized"
    ) {
      return this._buildConvergenceSummary(controller.mission_id);
    }
    this._assertConvergencePublicationRun({ controller, run: publishRun });
    const plan = this._getConvergenceRunPlan({ controller, run: publishRun });
    const seamId = plan.convergence_seam_id || controller.active_seam_id;
    const seam = seamId ? this._getConvergenceSeam(seamId) : null;
    if (!seam) {
      return this._buildConvergenceSummary(controller.mission_id);
    }
    // Maturity advances by default: a publish whose seam has a positive
    // expected_maturity_gain is treated as material UNLESS the caller explicitly
    // sets material_maturity_gain: false. This is intentional — a finalized
    // publish on an advancing seam should move the controller forward without
    // requiring every caller to opt in — so omission means "advance", and only
    // an explicit false (e.g. a no-op/docs-only publish) holds maturity steady.
    const materialGain = evidence.content?.material_maturity_gain !== false && Number(seam.expected_maturity_gain ?? 0) > 0;
    const updatedSeam = this._upsertConvergenceSeam({
      ...seam,
      status: "delivered",
      delivered_run_id: publishRun.id,
      publication_evidence_id: evidence.id
    });
    this._appendRunDeliverable(publishRun.id, evidence.id);

    let nextMaturity = controller.current_maturity;
    if (materialGain && seam.advances_to?.trim()) {
      nextMaturity = seam.advances_to.trim();
    }
    this._upsertConvergenceController({
      ...controller,
      current_maturity: nextMaturity,
      publish_finalization: {
        run_id: publishRun.id,
        evidence_id: evidence.id,
        state: "finalized",
        material_maturity_gain: materialGain,
        finalized_at: this.now().toISOString()
      }
    });
    this._electConvergenceState(controller.mission_id);
    return this._buildConvergenceSummary(controller.mission_id);
  }

  _enlightenmentReadiness(missionId) {
    const activations = this.activationList({ mission_id: missionId }).activations;
    const reviews = this.reviewList({ mission_id: missionId }).reviews;
    const byCapability = new Map();
    for (const activation of activations) {
      const activationReviews = reviews.filter((review) => review.activation_id === activation.id);
      const pass = activation.status === RUN_COMPLETED && activationReviews.length > 0 && activationReviews.every((review) => review.verdict === ReviewVerdict.PASS);
      const entry = byCapability.get(activation.capability_id) || { capability_id: activation.capability_id, successful_activations: 0, eligible_for_promotion: false };
      if (pass) {
        entry.successful_activations += 1;
      }
      entry.eligible_for_promotion = entry.successful_activations >= 3;
      byCapability.set(activation.capability_id, entry);
    }
    return [...byCapability.values()];
  }

  _ensureBuiltinCapabilities() {
    if (!this._capabilityExists(DEFAULT_CAPABILITY_ID)) {
      this._insertCapability({
        id: DEFAULT_CAPABILITY_ID,
        mission_id: SYSTEM_SCOPE_ID,
        name: "General Delivery Workflow",
        type: "workflow",
        triggers: ["default"],
        inputs: ["mission", "brief", "plan"],
        outputs: ["run", "reviews", "verification"],
        protocols: ["mcp", "a2a"],
        policy_scope: "workflow-core",
        matchers: { fallback: true },
        workflow_template: [...DEFAULT_WORKFLOW_TEMPLATE],
        review_policy_refs: [...DEFAULT_REVIEW_POLICY_REFS],
        executor_modes: ["local", "a2a", "agent"],
        promotion_source: CapabilityPromotionSource.HAND_AUTHORED,
        usage_count: 0,
        effectiveness_score: 1,
        status: CapabilityStatus.PROMOTED,
        payload: { builtin: true }
      });
    }

    if (!this._capabilityExists(DEBUG_CAPABILITY_ID)) {
      this._insertCapability({
        id: DEBUG_CAPABILITY_ID,
        mission_id: SYSTEM_SCOPE_ID,
        name: "Debugging Workflow",
        type: "workflow",
        triggers: ["debug", "bug", "fix", "regression"],
        inputs: ["mission", "brief", "plan"],
        outputs: ["run", "reviews", "verification"],
        protocols: ["mcp", "a2a"],
        policy_scope: "workflow-core",
        matchers: {
          mission_keywords: ["debug", "bug", "fix", "regression", "failure"],
          plan_action_keywords: ["debug", "fix", "reproduce", "trace", "root cause"]
        },
        workflow_template: [...DEFAULT_WORKFLOW_TEMPLATE],
        review_policy_refs: [...DEFAULT_REVIEW_POLICY_REFS],
        executor_modes: ["local", "a2a", "agent"],
        promotion_source: CapabilityPromotionSource.HAND_AUTHORED,
        usage_count: 0,
        effectiveness_score: 2,
        status: CapabilityStatus.PROMOTED,
        payload: { builtin: true }
      });
    }
  }

  _capabilityExists(capabilityId) {
    return Boolean(this._stmts.capabilities_exists.get(capabilityId));
  }

  _touchMission(missionId) {
    this.db.prepare(`UPDATE missions SET updated_at = ? WHERE id = ?`).run(this.now().toISOString(), missionId);
  }

  _getMission(missionId) {
    const row = this._stmts.missions_get_by_id.get(missionId);
    if (!row) {
      throw new Error(`mission ${missionId} not found`);
    }
    return this._decorateMission(parseMissionRow(row));
  }

  _insertBrief(data) {
    const revision = Number(this._stmts.briefs_max_revision.get(data.mission_id)?.revision ?? 0) + 1;
    const brief = {
      schema_version: ROI_SCHEMA_VERSION,
      mission_id: data.mission_id,
      revision,
      problem: data.problem ?? "",
      constraints: asArray(data.constraints),
      success_criteria: asArray(data.success_criteria),
      non_goals: asArray(data.non_goals),
      assumptions: asArray(data.assumptions),
      open_questions: asArray(data.open_questions),
      audience: data.audience ?? "",
      created_at: this.now().toISOString()
    };
    this.db.prepare(`INSERT INTO briefs (mission_id, revision, data_json, created_at) VALUES (?, ?, ?, ?)`).run(
      brief.mission_id,
      brief.revision,
      json(brief),
      brief.created_at
    );
    return brief;
  }

  _getLatestBrief(missionId) {
    const row = this._stmts.briefs_get_latest.get(missionId);
    return row ? parseRowJson(row.data_json, "entity") : null;
  }

  _insertPlan(data) {
    const revision = Number(this._stmts.plans_max_revision.get(data.id)?.revision ?? 0) + 1;
    const timestamp = this.now().toISOString();
    const plan = {
      schema_version: ROI_SCHEMA_VERSION,
      id: data.id,
      revision,
      mission_id: data.mission_id,
      name: data.name,
      scope: data.scope ?? "",
      inputs: asArray(data.inputs),
      actions: asArray(data.actions),
      dependencies: asArray(data.dependencies),
      verification_targets: asArray(data.verification_targets),
      source_contract_refs: asArray(data.source_contract_refs),
      requires_source_contract_check: Boolean(data.requires_source_contract_check),
      capability_id: data.capability_id ?? "",
      workflow_template_ref: data.workflow_template_ref ?? "",
      workflow_template: asStageArray(data.workflow_template, DEFAULT_WORKFLOW_TEMPLATE),
      convergence_seam_id: data.convergence_seam_id ?? "",
      status: data.status ?? "planned",
      wave: Number(data.wave ?? 1),
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.prepare(`
      INSERT INTO plans (id, revision, mission_id, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(plan.id, plan.revision, plan.mission_id, json(plan), plan.created_at, plan.updated_at);
    return plan;
  }

  _getLatestPlan(planId) {
    const row = this._stmts.plans_get_latest.get(planId);
    if (!row) {
      throw new Error(`plan ${planId} not found`);
    }
    return parsePlan(parseRowJson(row.data_json, "entity"));
  }

  _listLatestPlans(missionId) {
    const rows = this._stmts.plans_list_latest_by_mission.all(missionId);
    return rows.map((row) => this._getLatestPlan(row.id));
  }

  _insertContextPack(data) {
    const contextPack = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("context"),
      mission_id: data.mission_id,
      purpose: data.purpose ?? "",
      sources: asArray(data.sources),
      constraints: asArray(data.constraints),
      budget: asObject(data.budget),
      generated_at: this.now().toISOString(),
      freshness_ttl: Number(data.freshness_ttl ?? 900)
    };
    this.db.prepare(`INSERT INTO context_packs (id, mission_id, data_json, generated_at) VALUES (?, ?, ?, ?)`).run(
      contextPack.id,
      contextPack.mission_id,
      json(contextPack),
      contextPack.generated_at
    );
    return contextPack;
  }

  _getContextPack(id) {
    if (!id) {
      return null;
    }
    const row = this.db.prepare(`SELECT data_json FROM context_packs WHERE id = ?`).get(id);
    return row ? parseRowJson(row.data_json, "entity") : null;
  }

  _insertRun(data) {
    const timestamp = this.now().toISOString();
    const run = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("run"),
      mission_id: data.mission_id,
      status: data.status ?? RUN_QUEUED,
      summary: data.summary ?? "",
      plan_ids: asArray(data.plan_ids),
      capabilities_used: asArray(data.capabilities_used),
      context_pack_refs: asArray(data.context_pack_refs),
      deliverable_refs: asArray(data.deliverable_refs),
      task_refs: asArray(data.task_refs),
      trace_refs: asArray(data.trace_refs),
      protocol_refs: asArray(data.protocol_refs),
      checkpoint_refs: asArray(data.checkpoint_refs),
      activation_refs: asArray(data.activation_refs),
      routing_refs: asArray(data.routing_refs),
      review_refs: asArray(data.review_refs),
      started_at: timestamp,
      ended_at: data.ended_at ?? "",
      updated_at: timestamp
    };
    this.db.prepare(`INSERT INTO runs (id, mission_id, data_json, started_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
      run.id,
      run.mission_id,
      json(run),
      run.started_at,
      run.updated_at
    );
    return run;
  }

  _getRun(runId) {
    const row = this._stmts.runs_get_by_id.get(runId);
    if (!row) {
      throw new Error(`run ${runId} not found`);
    }
    return parseRowJson(row.data_json, "entity");
  }

  _getMissionRun(missionId, runId) {
    const run = this._getRun(runId);
    if (run.mission_id !== missionId) {
      throw new Error(`run ${run.id} does not belong to mission ${missionId}`);
    }
    return run;
  }

  _assertConvergenceExecutablePlanIds({ mission_id, controller, plan_ids }) {
    if ([CONVERGENCE_STATE_PAUSED_FOR_JUDGMENT, CONVERGENCE_STATE_BLOCKED].includes(controller.state)) {
      throw new Error(`mission ${mission_id} is ${controller.state}`);
    }
    if ([CONVERGENCE_STATE_CONVERGED, CONVERGENCE_STATE_RESIDUAL_GAP].includes(controller.state)) {
      throw new Error(`mission ${mission_id} is already ${controller.state}`);
    }
    if (!controller.active_plan_id) {
      throw new Error(`mission ${mission_id} has no active convergence plan`);
    }
    const requestedPlanIds = plan_ids?.length ? plan_ids : [controller.active_plan_id];
    if (requestedPlanIds.length !== 1 || requestedPlanIds[0] !== controller.active_plan_id) {
      throw new Error(`convergence mission ${mission_id} may only run active plan ${controller.active_plan_id}`);
    }
    const activePlan = this._getLatestPlan(controller.active_plan_id);
    if (activePlan.mission_id !== mission_id) {
      throw new Error(`active convergence plan ${activePlan.id} does not belong to mission ${mission_id}`);
    }
    if (controller.active_seam_id && activePlan.convergence_seam_id !== controller.active_seam_id) {
      throw new Error(`active convergence plan ${activePlan.id} does not match seam ${controller.active_seam_id}`);
    }
    return activePlan;
  }

  _getConvergenceRunPlan({ controller, run }) {
    if (run.plan_ids.length !== 1) {
      throw new Error(`convergence run ${run.id} must reference exactly one plan`);
    }
    const plan = this._getLatestPlan(run.plan_ids[0]);
    if (plan.mission_id !== controller.mission_id) {
      throw new Error(`plan ${plan.id} does not belong to convergence mission ${controller.mission_id}`);
    }
    if (!plan.convergence_seam_id) {
      throw new Error(`plan ${plan.id} is not bound to a convergence seam`);
    }
    return plan;
  }

  _assertConvergencePublicationRun({ controller, run }) {
    if (!run) {
      throw new Error(`convergence mission ${controller.mission_id} requires a completed run for publication`);
    }
    if (run.status !== RUN_COMPLETED) {
      throw new Error(`run ${run.id} is not publishable`);
    }
    if (
      controller.publish_finalization?.run_id === run.id &&
      controller.publish_finalization?.state === "finalized"
    ) {
      return this._getConvergenceRunPlan({ controller, run });
    }
    const plan = this._getConvergenceRunPlan({ controller, run });
    if (controller.active_plan_id && plan.id !== controller.active_plan_id) {
      throw new Error(`convergence mission ${controller.mission_id} may only publish active plan ${controller.active_plan_id}`);
    }
    if (controller.active_seam_id && plan.convergence_seam_id !== controller.active_seam_id) {
      throw new Error(`convergence mission ${controller.mission_id} may only publish active seam ${controller.active_seam_id}`);
    }
    return plan;
  }

  _assertPublicationEvidenceRun({ run, evidenceType }) {
    if (!run) {
      throw new Error(`${evidenceType} evidence requires run_id`);
    }
    if (run.status === RUN_COMPLETED) {
      return;
    }
    if (evidenceType === "handoff" && this._runHasPassingVerifyEvidence(run.id)) {
      return;
    }
    throw new Error(`run ${run.id} is not publishable`);
  }

  _runHasPassingVerifyEvidence(runId) {
    return this.evidenceList({ run_id: runId, mission_id: this._getRun(runId).mission_id }).evidence.some((evidence) =>
      evidence.source === "verify.evaluate" &&
      evidence.type === "verification" &&
      String(evidence.result ?? "").trim().toLowerCase() === VerifyVerdict.PASS
    );
  }

  _updateRun(run) {
    const updated = {
      ...run,
      updated_at: this.now().toISOString()
    };
    this.db.prepare(`UPDATE runs SET data_json = ?, updated_at = ? WHERE id = ?`).run(json(updated), updated.updated_at, updated.id);
    return updated;
  }

  _appendRunRefs(run, traceRefs = [], protocolRefs = [], reviewRefs = []) {
    return this._updateRun({
      ...run,
      trace_refs: unique([...asArray(run.trace_refs), ...asArray(traceRefs)]),
      protocol_refs: unique([...asArray(run.protocol_refs), ...asArray(protocolRefs)]),
      review_refs: unique([...asArray(run.review_refs), ...asArray(reviewRefs)])
    });
  }

  _appendRunDeliverable(runId, evidenceId) {
    const run = this._getRun(runId);
    return this._updateRun({
      ...run,
      deliverable_refs: unique([...asArray(run.deliverable_refs), evidenceId])
    });
  }

  _insertTask(data) {
    const timestamp = this.now().toISOString();
    const task = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("task"),
      mission_id: data.mission_id,
      plan_id: data.plan_id ?? "",
      run_id: data.run_id ?? "",
      kind: data.kind ?? "plan_task",
      status: data.status ?? TASK_QUEUED,
      assignee: data.assignee ?? "",
      checkpoint_ref: data.checkpoint_ref ?? "",
      retry_count: Number(data.retry_count ?? 0),
      blocking_reason: data.blocking_reason ?? "",
      payload: asObject(data.payload),
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.prepare(`INSERT INTO tasks (id, mission_id, run_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      task.id,
      task.mission_id,
      task.run_id,
      json(task),
      task.created_at,
      task.updated_at
    );
    return task;
  }

  _getTask(taskId) {
    const row = this._stmts.tasks_get_by_id.get(taskId);
    if (!row) {
      throw new Error(`task ${taskId} not found`);
    }
    return parseRowJson(row.data_json, "entity");
  }

  _listRunTasks(runId) {
    return this.taskList({ run_id: runId }).tasks;
  }

  _updateTask(task) {
    const updated = {
      ...task,
      updated_at: this.now().toISOString()
    };
    this.db.prepare(`UPDATE tasks SET data_json = ?, updated_at = ? WHERE id = ?`).run(json(updated), updated.updated_at, updated.id);
    return updated;
  }

  _insertEvidence(data) {
    const evidence = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("evidence"),
      mission_id: data.mission_id,
      run_id: data.run_id ?? "",
      type: data.type ?? "note",
      source: data.source ?? "",
      result: data.result ?? "",
      artifact_ref: data.artifact_ref ?? "",
      content: asObject(data.content),
      captured_at: this.now().toISOString()
    };
    this.db.prepare(`INSERT INTO evidence (id, mission_id, run_id, data_json, captured_at) VALUES (?, ?, ?, ?, ?)`).run(
      evidence.id,
      evidence.mission_id,
      evidence.run_id,
      json(evidence),
      evidence.captured_at
    );
    return evidence;
  }

  _insertTrace(data) {
    const trace = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("trace"),
      mission_id: data.mission_id,
      run_id: data.run_id ?? "",
      task_id: data.task_id ?? "",
      events: asArray(data.events),
      tool_calls: asArray(data.tool_calls),
      latency_ms: Number(data.latency_ms ?? 0),
      token_usage: asObject(data.token_usage),
      error_signals: asArray(data.error_signals),
      evaluation_refs: asArray(data.evaluation_refs),
      created_at: this.now().toISOString()
    };
    this.db.prepare(`INSERT INTO traces (id, mission_id, run_id, task_id, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      trace.id,
      trace.mission_id,
      trace.run_id,
      trace.task_id,
      json(trace),
      trace.created_at
    );
    return trace;
  }

  _insertPolicyDecision(data) {
    const decision = {
      schema_version: ROI_SCHEMA_VERSION,
      id: data.id || newId("policy"),
      mission_id: data.mission_id ?? "",
      run_id: data.run_id ?? "",
      task_id: data.task_id ?? "",
      subject: data.subject ?? "",
      decision: data.decision ?? "allow",
      reason: data.reason ?? "",
      policy_pack_ref: data.policy_pack_ref ?? "roi-default",
      created_at: data.created_at || this.now().toISOString()
    };
    this.db.prepare(`
      INSERT INTO policy_decisions (id, mission_id, run_id, task_id, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(decision.id, decision.mission_id, decision.run_id, decision.task_id, json(decision), decision.created_at);
    return decision;
  }

  _listPolicyDecisions(missionId) {
    const rows = this.db.prepare(`SELECT data_json FROM policy_decisions WHERE mission_id = ? ORDER BY created_at DESC`).all(missionId);
    return rows.map((row) => parseRowJson(row.data_json, "entity"));
  }

  _insertProtocolBinding(data) {
    const timestamp = this.now().toISOString();
    const binding = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("binding"),
      mission_id: data.mission_id ?? "",
      run_id: data.run_id ?? "",
      task_id: data.task_id ?? "",
      protocol: data.protocol ?? "",
      endpoint: data.endpoint ?? "",
      auth_mode: data.auth_mode ?? "",
      artifact_contract: data.artifact_contract ?? "",
      status: data.status ?? "",
      payload: asObject(data.payload),
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.prepare(`
      INSERT INTO protocol_bindings (id, mission_id, run_id, task_id, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(binding.id, binding.mission_id, binding.run_id, binding.task_id, json(binding), binding.created_at, binding.updated_at);
    return binding;
  }

  _updateProtocolBinding(binding) {
    const updated = {
      ...binding,
      updated_at: this.now().toISOString()
    };
    this.db.prepare(`UPDATE protocol_bindings SET data_json = ?, updated_at = ? WHERE id = ?`).run(json(updated), updated.updated_at, updated.id);
    return updated;
  }

  _insertRoutingDecision(data) {
    this.db.prepare(`
      INSERT INTO routing_decisions (id, mission_id, plan_id, capability_id, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.id, data.mission_id, data.plan_id, data.capability_id, json(data), data.created_at);
    return data;
  }

  _getLatestRouteForPlan(planId) {
    if (!planId) {
      return null;
    }
    const row = this._stmts.routing_get_by_plan.get(planId);
    return row ? parseRowJson(row.data_json, "entity") : null;
  }

  _insertActivation(data) {
    const timestamp = this.now().toISOString();
    const activation = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("activation"),
      mission_id: data.mission_id,
      run_id: data.run_id,
      plan_id: data.plan_id,
      capability_id: data.capability_id,
      executor_mode: data.executor_mode,
      workflow_template: asStageArray(data.workflow_template, DEFAULT_WORKFLOW_TEMPLATE),
      status: data.status ?? RUN_QUEUED,
      task_refs: asArray(data.task_refs),
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.prepare(`
      INSERT INTO capability_activations (id, mission_id, run_id, plan_id, capability_id, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      activation.id,
      activation.mission_id,
      activation.run_id,
      activation.plan_id,
      activation.capability_id,
      json(activation),
      activation.created_at,
      activation.updated_at
    );
    return activation;
  }

  _getActivation(activationId) {
    const row = this._stmts.activations_get_by_id.get(activationId);
    if (!row) {
      throw new Error(`activation ${activationId} not found`);
    }
    return parseRowJson(row.data_json, "entity");
  }

  _updateActivation(activation) {
    const updated = {
      ...activation,
      updated_at: this.now().toISOString()
    };
    this.db.prepare(`UPDATE capability_activations SET data_json = ?, updated_at = ? WHERE id = ?`).run(json(updated), updated.updated_at, updated.id);
    return updated;
  }

  _insertReviewRecord(data) {
    const timestamp = this.now().toISOString();
    const review = {
      schema_version: ROI_SCHEMA_VERSION,
      id: newId("review"),
      mission_id: data.mission_id,
      run_id: data.run_id,
      task_id: data.task_id,
      activation_id: data.activation_id ?? "",
      review_type: data.review_type,
      subject_ref: data.subject_ref,
      verdict: data.verdict,
      blocking_issues: asArray(data.blocking_issues),
      evidence_refs: asArray(data.evidence_refs),
      trace_refs: asArray(data.trace_refs),
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.prepare(`
      INSERT INTO review_records (id, mission_id, run_id, task_id, activation_id, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      review.id,
      review.mission_id,
      review.run_id,
      review.task_id,
      review.activation_id,
      json(review),
      review.created_at,
      review.updated_at
    );
    return review;
  }

  _getReviewRecord(reviewId) {
    const row = this._stmts.reviews_get_by_id.get(reviewId);
    if (!row) {
      throw new Error(`review ${reviewId} not found`);
    }
    return parseRowJson(row.data_json, "entity");
  }

  _insertOrUpdatePattern(data) {
    const timestamp = this.now().toISOString();
    const pattern = {
      schema_version: ROI_SCHEMA_VERSION,
      id: data.id || newId("pattern"),
      mission_id: data.mission_id,
      signature: data.signature ?? "",
      evidence_refs: asArray(data.evidence_refs),
      frequency: Number(data.frequency ?? 0),
      detected_in: asArray(data.detected_in),
      proposed_action: data.proposed_action ?? "",
      promotion_target: data.promotion_target ?? "",
      status: data.status ?? PatternStatus.DETECTED,
      created_at: data.created_at || timestamp,
      updated_at: timestamp
    };
    const existing = this.db.prepare(`SELECT id FROM patterns WHERE id = ?`).get(pattern.id);
    if (existing) {
      this.db.prepare(`UPDATE patterns SET data_json = ?, updated_at = ? WHERE id = ?`).run(json(pattern), pattern.updated_at, pattern.id);
    } else {
      this.db.prepare(`INSERT INTO patterns (id, mission_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
        pattern.id,
        pattern.mission_id,
        json(pattern),
        pattern.created_at,
        pattern.updated_at
      );
    }
    return pattern;
  }

  _insertCapability(data) {
    const revision = Number(this.db.prepare(`SELECT COALESCE(MAX(revision), 0) AS revision FROM capabilities WHERE id = ?`).get(data.id)?.revision ?? 0) + 1;
    const timestamp = this.now().toISOString();
    const capability = {
      schema_version: ROI_SCHEMA_VERSION,
      id: data.id,
      revision,
      mission_id: data.mission_id,
      name: data.name,
      type: data.type ?? "workflow",
      triggers: asArray(data.triggers),
      inputs: asArray(data.inputs),
      outputs: asArray(data.outputs),
      protocols: asArray(data.protocols),
      policy_scope: data.policy_scope ?? "human-gated",
      matchers: asObject(data.matchers),
      workflow_template: asStageArray(data.workflow_template, DEFAULT_WORKFLOW_TEMPLATE),
      review_policy_refs: asArray(data.review_policy_refs).length ? asArray(data.review_policy_refs) : [...DEFAULT_REVIEW_POLICY_REFS],
      executor_modes: asExecutorModes(data.executor_modes),
      promotion_source: data.promotion_source ?? CapabilityPromotionSource.HAND_AUTHORED,
      usage_count: Number(data.usage_count ?? 0),
      effectiveness_score: Number(data.effectiveness_score ?? 0),
      status: data.status ?? CapabilityStatus.PROPOSED,
      payload: asObject(data.payload),
      created_at: timestamp,
      updated_at: timestamp
    };
    this.db.prepare(`
      INSERT INTO capabilities (id, revision, mission_id, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(capability.id, capability.revision, capability.mission_id, json(capability), capability.created_at, capability.updated_at);
    return capability;
  }

  _getLatestCapability(capabilityId) {
    const row = this.db.prepare(`SELECT data_json FROM capabilities WHERE id = ? ORDER BY revision DESC LIMIT 1`).get(capabilityId);
    if (!row) {
      throw new Error(`capability ${capabilityId} not found`);
    }
    return parseRowJson(row.data_json, "entity");
  }

  _convergenceSkipPlanIds(missionId) {
    const controller = this._getConvergenceController(missionId);
    if (!controller) {
      return [];
    }
    return this._listConvergenceSeams(missionId)
      .filter((seam) => seam.status === "delivered")
      .map((seam) => seam.plan_id)
      .filter(Boolean);
  }

  _missionNeedsRoiGo(missionId, { planIds } = {}) {
    const plans = this._listLatestPlans(missionId);
    const evidence = this.evidenceList({ mission_id: missionId }).evidence;
    return missionNeedsRoiGo(plans, evidence, {
      skipPlanIds: this._convergenceSkipPlanIds(missionId),
      planIds
    });
  }

  _missionGoProgress(missionId) {
    const plans = this._listLatestPlans(missionId);
    const evidence = this.evidenceList({ mission_id: missionId }).evidence;
    return missionGoProgress(plans, evidence, { skipPlanIds: this._convergenceSkipPlanIds(missionId) });
  }

  _partialVerificationEligible(missionId) {
    const plans = this._listLatestPlans(missionId);
    const evidence = this.evidenceList({ mission_id: missionId }).evidence;
    return partialVerificationEligible(plans, evidence, {
      skipPlanIds: this._convergenceSkipPlanIds(missionId)
    });
  }

  _missionImplementationProofTrust(missionId) {
    const plans = this._listLatestPlans(missionId);
    const evidence = this.evidenceList({ mission_id: missionId }).evidence;
    return missionImplementationProofTrust(plans, evidence, {
      skipPlanIds: this._convergenceSkipPlanIds(missionId)
    });
  }

  _activeBlockingIssues(missionId, reviews) {
    const plans = this._listLatestPlans(missionId);
    const evidence = this.evidenceList({ mission_id: missionId }).evidence;
    return activeBlockingIssues(reviews, {
      plans,
      evidence,
      taskForReview: (review) => {
        if (!review.task_id) {
          return null;
        }
        try {
          return this._getTask(review.task_id);
        } catch {
          return null;
        }
      }
    });
  }

  _nextActions(missionId) {
    const mission = this._getMission(missionId);
    const controller = this._getConvergenceController(missionId);
    const needsGo = this._missionNeedsRoiGo(missionId);
    if (mission.status === MISSION_ARCHIVED) {
      return [];
    }
    if (!this._getLatestBrief(missionId)) {
      return ["roi:brief"];
    }
    if (!this._listLatestPlans(missionId).length) {
      return ["roi:source", "roi:outline"];
    }
    const latestRun = this.runList({ mission_id: missionId }).runs[0];
    if (!latestRun) {
      if (controller) {
        if (controller.state === CONVERGENCE_STATE_ACTIVE && controller.active_plan_id) {
          return needsGo ? ["roi:go", "roi:draft", "roi:inspect"] : ["roi:draft", "roi:inspect"];
        }
        if ([CONVERGENCE_STATE_PAUSED_FOR_JUDGMENT, CONVERGENCE_STATE_BLOCKED].includes(controller.state)) {
          return ["roi:inspect"];
        }
        if ([CONVERGENCE_STATE_CONVERGED, CONVERGENCE_STATE_RESIDUAL_GAP].includes(controller.state)) {
          const proposedCapabilities = this.capabilityList({ mission_id: missionId }).capabilities
            .filter((capability) => capability.status === CapabilityStatus.PROPOSED);
          return proposedCapabilities.length > 0
            ? ["capability.promote", "roi:inspect"]
            : ["roi:learn", "roi:inspect"];
        }
      }
      return needsGo ? ["roi:go", "roi:draft"] : ["roi:draft"];
    }
    const proposedCapabilities = this.capabilityList({ mission_id: missionId }).capabilities
      .filter((capability) => capability.status === CapabilityStatus.PROPOSED);
    const latestRunEvidence = this.evidenceList({ mission_id: missionId, run_id: latestRun.id }).evidence;
    const published = latestRunEvidence.some((evidence) => ["publication", "handoff"].includes(evidence.type));
    if (latestRun.status === RUN_PAUSED && latestRun.summary === "Awaiting review") {
      return ["roi:review"];
    }
    if (latestRun.status === RUN_COMPLETED) {
      if (published) {
        if (controller) {
          if (controller.state === CONVERGENCE_STATE_ACTIVE && controller.active_plan_id) {
            return needsGo ? ["roi:go", "roi:draft", "roi:inspect"] : ["roi:draft", "roi:inspect"];
          }
          if ([CONVERGENCE_STATE_PAUSED_FOR_JUDGMENT, CONVERGENCE_STATE_BLOCKED].includes(controller.state)) {
            return ["roi:inspect"];
          }
        }
        return proposedCapabilities.length > 0
          ? ["capability.promote", "roi:inspect"]
          : ["roi:learn", "roi:inspect"];
      }
      return ["roi:publish", "roi:learn"];
    }
    if ([RUN_PAUSED, RUN_BLOCKED].includes(latestRun.status)) {
      return pausedRunNextActions({
        needsGo,
        blocked: latestRun.status === RUN_BLOCKED
      });
    }
    return ["roi:inspect"];
  }
}

export class LocalExecutor {
  execute({ prompt }) {
    return `LOCAL_EXECUTION_COMPLETED\n${prompt || ""}`.trim();
  }
}

export function defaultPolicyEvaluator({ mission_id = "", run_id = "", task_id = "", subject = "", mode = "local" }) {
  const dangerous = /(rm\s+-rf|git\s+reset\s+--hard|DROP\s+TABLE)/i.test(subject);
  return {
    id: newId("policy"),
    mission_id,
    run_id,
    task_id,
    subject,
    decision: dangerous ? "deny" : "allow",
    reason: dangerous ? "Dangerous execution subject requires explicit approval" : "Allowed by roi-default policy",
    policy_pack_ref: mode === "a2a" ? "roi-a2a-policy" : "roi-default",
    created_at: new Date().toISOString()
  };
}

function mutation(meta, payload = {}) {
  return { ...meta, ...payload };
}

function parseMissionRow(row) {
  return {
    schema_version: ROI_SCHEMA_VERSION,
    id: row.id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    priority: row.priority,
    owner: row.owner,
    workspace_refs: parseOptionalRowJson(row.workspace_refs_json, "mission workspace_refs", []),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function parsePlan(plan) {
  return {
    ...plan,
    source_contract_refs: asArray(plan.source_contract_refs),
    requires_source_contract_check: Boolean(plan.requires_source_contract_check),
    convergence_seam_id: plan.convergence_seam_id || ""
  };
}

function mapA2AState(state) {
  switch (state) {
    case "completed":
      return { run_status: RUN_COMPLETED, task_status: TASK_COMPLETED, blocking_reason: "", final: true };
    case "canceled":
      return { run_status: RUN_CANCELLED, task_status: TASK_CANCELLED, blocking_reason: "remote_cancelled", final: true };
    case "failed":
    case "rejected":
      return { run_status: RUN_FAILED, task_status: TASK_FAILED, blocking_reason: "remote_failure", final: true };
    case "auth-required":
      return { run_status: RUN_PAUSED, task_status: TASK_AUTH_REQUIRED, blocking_reason: "remote_auth_required", final: false };
    case "input-required":
      return { run_status: RUN_PAUSED, task_status: TASK_INPUT_REQUIRED, blocking_reason: "remote_input_required", final: false };
    case "working":
    case "submitted":
    default:
      return { run_status: RUN_PAUSED, task_status: TASK_WAITING, blocking_reason: "waiting_on_external", final: false };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && item !== "") : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function activeBlockingIssues(reviews, { plans = [], evidence = [], taskForReview = () => null } = {}) {
  const latestByReviewSlot = new Map();
  for (const review of reviews) {
    latestByReviewSlot.set(reviewSupersessionKey(review), review);
  }
  return [...latestByReviewSlot.values()]
    .map((review) => {
      const task = taskForReview(review);
      const roiGoSatisfied = task?.plan_id
        ? substantiveRoiGoForPlan(evidence, task.plan_id, plans)
        : false;
      return {
        review,
        blocking_issues: filterReviewBlockingIssues(review.blocking_issues, { roiGoSatisfied })
      };
    })
    .filter(({ blocking_issues }) => blocking_issues.length > 0)
    .map(({ review, blocking_issues }) => ({
      review_id: review.id,
      review_type: review.review_type,
      blocking_issues
    }));
}

function reviewSupersessionKey(review) {
  if (review.task_id) {
    return `task:${review.task_id}:${review.review_type}`;
  }
  if (review.activation_id) {
    return `activation:${review.activation_id}:${review.review_type}`;
  }
  return `review:${review.id}`;
}

function asStageArray(value, fallback) {
  const stages = asArray(value);
  return stages.length ? stages : [...fallback];
}

function asExecutorModes(value) {
  const modes = asArray(value).filter((mode) => mode === "local" || mode === "a2a" || mode === "agent");
  return modes.length ? modes : ["local"];
}

function compactJoin(parts) {
  return parts.filter(Boolean).join(" ");
}

function json(value) {
  return JSON.stringify(value);
}

// Parse a persisted entity blob. A corrupted row is a hard data-integrity
// fault, not something to silently paper over with a fallback — so we surface a
// contextual error instead of letting a raw SyntaxError (or a downstream
// "cannot read property of null") obscure which row is bad. For optional
// sub-columns that may legitimately be absent, use parseOptionalRowJson.
function parseRowJson(value, context) {
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`corrupted ${context} row: invalid JSON in data_json (${err.message})`);
  }
}

// Like parseRowJson but for an optional sub-column that may legitimately be
// absent (NULL/empty): an absent value yields `fallback`, while a *present but
// malformed* blob is still treated as corruption and surfaced loudly. This keeps
// the "fail loud on corruption" invariant without rejecting legacy rows that
// never wrote the optional field.
function parseOptionalRowJson(value, context, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`corrupted ${context} row: invalid JSON (${err.message})`);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
