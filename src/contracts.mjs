import { z } from "zod";

export const ROI_SCHEMA_VERSION = 2;
export const SYSTEM_SCOPE_ID = "__system__";

export const MissionStatus = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived"
});

export const RunStatus = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  BLOCKED: "blocked",
  PAUSED: "paused",
  CANCELLED: "cancelled"
});

export const TaskStatus = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  INPUT_REQUIRED: "input_required",
  APPROVAL_REQUIRED: "approval_required",
  AUTH_REQUIRED: "auth_required",
  WAITING_ON_EXTERNAL: "waiting_on_external",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

export const PatternStatus = Object.freeze({
  DETECTED: "detected",
  PROPOSED: "proposed",
  PROMOTED: "promoted",
  ARCHIVED: "archived"
});

export const CapabilityStatus = Object.freeze({
  PROPOSED: "proposed",
  PROMOTED: "promoted",
  ARCHIVED: "archived"
});

export const CapabilityPromotionSource = Object.freeze({
  HAND_AUTHORED: "hand_authored",
  ENLIGHTEN_PROPOSED: "enlighten_proposed",
  ENLIGHTEN_PROMOTED: "enlighten_promoted"
});

export const ReviewVerdict = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  PARTIAL: "partial",
  INCONCLUSIVE: "inconclusive"
});

export const VerifyVerdict = ReviewVerdict;

export const StageKind = Object.freeze({
  IMPLEMENT: "implement",
  SPEC_REVIEW: "spec_review",
  QUALITY_REVIEW: "quality_review",
  VERIFY_GATE: "verify_gate"
});

export const DEFAULT_WORKFLOW_TEMPLATE = Object.freeze([
  StageKind.IMPLEMENT,
  StageKind.SPEC_REVIEW,
  StageKind.QUALITY_REVIEW,
  StageKind.VERIFY_GATE
]);

export const DEFAULT_REVIEW_POLICY_REFS = Object.freeze([
  "spec_compliance_review",
  "quality_review",
  "verify_gate"
]);

export const taskStateValues = Object.freeze(Object.values(TaskStatus));
export const runStateValues = Object.freeze(Object.values(RunStatus));
export const verifyVerdictValues = Object.freeze(Object.values(VerifyVerdict));
export const reviewVerdictValues = Object.freeze(Object.values(ReviewVerdict));
export const capabilityStatusValues = Object.freeze(Object.values(CapabilityStatus));
export const stageKindValues = Object.freeze(Object.values(StageKind));
export const executorModeValues = Object.freeze(["local", "a2a", "agent"]);
const executorModeEnum = z.enum(executorModeValues);
const executorModesArray = z.array(executorModeEnum);

const stringArray = z.array(z.string()).default([]);
const numberValue = z.number().default(0);
const looseRecord = z.record(z.string(), z.any()).default({});
const stageArray = z.array(z.enum(stageKindValues)).default(DEFAULT_WORKFLOW_TEMPLATE);
const seamPlanDraftSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  scope: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  actions: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  verification_targets: z.array(z.string()).optional(),
  source_contract_refs: z.array(z.string()).optional(),
  requires_source_contract_check: z.boolean().optional(),
  status: z.string().optional(),
  wave: z.number().optional()
});
const convergenceConfigSchema = z.object({
  domain: z.string().optional(),
  current_maturity: z.string().optional(),
  target_maturity: z.string().optional(),
  maturity_ladder: z.array(z.string()).optional(),
  autonomy_mode: z.enum(["manual", "auto_low_judgment"]).optional()
});
const convergenceSeamInputSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  summary: z.string().optional(),
  expected_maturity_gain: z.number().optional(),
  advances_to: z.string().optional(),
  unlock_score: z.number().optional(),
  evidence_confidence: z.number().optional(),
  requires_judgment: z.boolean().optional(),
  blocked_by: z.array(z.string()).optional(),
  manifest_order: z.number().optional(),
  plan: seamPlanDraftSchema.optional()
});

export const MissionSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  status: z.enum([MissionStatus.ACTIVE, MissionStatus.ARCHIVED]),
  priority: z.string(),
  owner: z.string(),
  workspace_refs: stringArray,
  convergence: convergenceConfigSchema.optional(),
  created_at: z.string(),
  updated_at: z.string()
});

export const BriefSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  mission_id: z.string(),
  revision: z.number(),
  problem: z.string(),
  constraints: stringArray,
  success_criteria: stringArray,
  non_goals: stringArray,
  assumptions: stringArray,
  open_questions: stringArray,
  audience: z.string(),
  created_at: z.string()
});

export const ResearchSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  question: z.string(),
  sources: stringArray,
  findings: stringArray,
  tradeoffs: stringArray,
  recommendation: z.string(),
  confidence: z.number(),
  created_at: z.string()
});

export const PlanSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  revision: z.number(),
  mission_id: z.string(),
  name: z.string(),
  scope: z.string(),
  inputs: stringArray,
  actions: stringArray,
  dependencies: stringArray,
  verification_targets: stringArray,
  source_contract_refs: stringArray,
  requires_source_contract_check: z.boolean().default(false),
  capability_id: z.string().default(""),
  workflow_template_ref: z.string().default(""),
  workflow_template: stageArray,
  convergence_seam_id: z.string().default(""),
  status: z.string(),
  wave: z.number(),
  created_at: z.string(),
  updated_at: z.string()
});

export const ContextPackSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  purpose: z.string(),
  sources: stringArray,
  constraints: stringArray,
  budget: looseRecord,
  generated_at: z.string(),
  freshness_ttl: z.number()
});

export const RunSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  status: z.enum(runStateValues),
  summary: z.string(),
  plan_ids: stringArray,
  capabilities_used: stringArray,
  context_pack_refs: stringArray,
  deliverable_refs: stringArray,
  task_refs: stringArray,
  trace_refs: stringArray,
  protocol_refs: stringArray,
  checkpoint_refs: stringArray,
  activation_refs: stringArray.default([]),
  routing_refs: stringArray.default([]),
  review_refs: stringArray.default([]),
  started_at: z.string(),
  ended_at: z.string(),
  updated_at: z.string()
});

export const TaskSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  plan_id: z.string(),
  run_id: z.string(),
  kind: z.string(),
  status: z.enum(taskStateValues),
  assignee: z.string(),
  checkpoint_ref: z.string(),
  retry_count: z.number(),
  blocking_reason: z.string(),
  payload: looseRecord,
  created_at: z.string(),
  updated_at: z.string()
});

export const EvidenceSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  run_id: z.string(),
  type: z.string(),
  source: z.string(),
  result: z.string(),
  artifact_ref: z.string(),
  content: looseRecord,
  captured_at: z.string()
});

export const TraceSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  run_id: z.string(),
  task_id: z.string(),
  events: stringArray,
  tool_calls: stringArray,
  latency_ms: z.number(),
  token_usage: looseRecord,
  error_signals: stringArray,
  evaluation_refs: stringArray,
  created_at: z.string()
});

export const PolicyDecisionSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  run_id: z.string(),
  task_id: z.string(),
  subject: z.string(),
  decision: z.enum(["allow", "deny"]),
  reason: z.string(),
  policy_pack_ref: z.string(),
  created_at: z.string()
});

export const ProtocolBindingSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  run_id: z.string(),
  task_id: z.string(),
  protocol: z.string(),
  endpoint: z.string(),
  auth_mode: z.string(),
  artifact_contract: z.string(),
  status: z.string(),
  payload: looseRecord,
  created_at: z.string(),
  updated_at: z.string()
});

export const RoutingDecisionSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  plan_id: z.string(),
  capability_id: z.string(),
  confidence: z.number(),
  reason: z.string(),
  rejected_alternatives: z.array(looseRecord).default([]),
  created_at: z.string()
});

export const CapabilityActivationSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  run_id: z.string(),
  plan_id: z.string(),
  capability_id: z.string(),
  executor_mode: executorModeEnum,
  workflow_template: stageArray,
  status: z.string(),
  task_refs: stringArray,
  created_at: z.string(),
  updated_at: z.string()
});

export const ReviewRecordSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  run_id: z.string(),
  task_id: z.string(),
  activation_id: z.string(),
  review_type: z.string(),
  subject_ref: z.string(),
  verdict: z.enum(reviewVerdictValues),
  blocking_issues: stringArray,
  evidence_refs: stringArray,
  trace_refs: stringArray,
  created_at: z.string(),
  updated_at: z.string()
});

export const PatternSchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  mission_id: z.string(),
  signature: z.string(),
  evidence_refs: stringArray,
  frequency: z.number(),
  detected_in: stringArray,
  proposed_action: z.string(),
  promotion_target: z.string(),
  status: z.enum(Object.values(PatternStatus)),
  created_at: z.string(),
  updated_at: z.string()
});

export const CapabilitySchema = z.object({
  schema_version: z.number().default(ROI_SCHEMA_VERSION),
  id: z.string(),
  revision: z.number(),
  mission_id: z.string(),
  name: z.string(),
  type: z.string(),
  triggers: stringArray,
  inputs: stringArray,
  outputs: stringArray,
  protocols: stringArray,
  policy_scope: z.string(),
  matchers: looseRecord,
  workflow_template: stageArray,
  review_policy_refs: stringArray.default(DEFAULT_REVIEW_POLICY_REFS),
  executor_modes: executorModesArray.default(["local"]),
  promotion_source: z.enum(Object.values(CapabilityPromotionSource)).default(CapabilityPromotionSource.HAND_AUTHORED),
  usage_count: numberValue,
  effectiveness_score: numberValue,
  status: z.enum(capabilityStatusValues),
  payload: looseRecord,
  created_at: z.string(),
  updated_at: z.string()
});

export const ToolSchemas = Object.freeze({
  missionCreate: z.object({
    title: z.string().optional(),
    goal: z.string().optional(),
    priority: z.string().optional(),
    owner: z.string().optional(),
    workspace_refs: z.array(z.string()).optional(),
    audience: z.string().optional(),
    convergence: convergenceConfigSchema.optional()
  }),
  missionGet: z.object({ mission_id: z.string() }),
  missionList: z.object({}),
  missionUpdate: z.object({
    mission_id: z.string(),
    title: z.string().optional(),
    goal: z.string().optional(),
    status: z.enum([MissionStatus.ACTIVE, MissionStatus.ARCHIVED]).optional(),
    priority: z.string().optional(),
    owner: z.string().optional(),
    workspace_refs: z.array(z.string()).optional(),
    convergence: convergenceConfigSchema.optional()
  }),
  missionArchive: z.object({ mission_id: z.string() }),
  briefRevise: z.object({
    mission_id: z.string(),
    problem: z.string().optional(),
    constraints: z.array(z.string()).optional(),
    success_criteria: z.array(z.string()).optional(),
    non_goals: z.array(z.string()).optional(),
    assumptions: z.array(z.string()).optional(),
    open_questions: z.array(z.string()).optional(),
    audience: z.string().optional()
  }),
  briefGetLatest: z.object({ mission_id: z.string() }),
  briefListRevisions: z.object({ mission_id: z.string() }),
  researchRecord: z.object({
    mission_id: z.string(),
    question: z.string().optional(),
    sources: z.array(z.string()).optional(),
    findings: z.array(z.string()).optional(),
    tradeoffs: z.array(z.string()).optional(),
    recommendation: z.string().optional(),
    confidence: z.number().optional()
  }),
  researchList: z.object({ mission_id: z.string() }),
  researchSummarize: z.object({ mission_id: z.string() }),
  planGenerate: z.object({
    mission_id: z.string(),
    plans: z.array(z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      scope: z.string().optional(),
      inputs: z.array(z.string()).optional(),
      actions: z.array(z.string()).optional(),
      dependencies: z.array(z.string()).optional(),
      verification_targets: z.array(z.string()).optional(),
      source_contract_refs: z.array(z.string()).optional(),
      requires_source_contract_check: z.boolean().optional(),
      status: z.string().optional(),
      wave: z.number().optional(),
      convergence_seam_id: z.string().optional()
    })).optional(),
    seams: z.array(convergenceSeamInputSchema).optional()
  }),
  planGet: z.object({ plan_id: z.string() }),
  planList: z.object({ mission_id: z.string() }),
  planRevise: z.object({
    plan_id: z.string(),
    name: z.string().optional(),
    scope: z.string().optional(),
    inputs: z.array(z.string()).optional(),
    actions: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    verification_targets: z.array(z.string()).optional(),
    source_contract_refs: z.array(z.string()).optional(),
    requires_source_contract_check: z.boolean().optional(),
    status: z.string().optional(),
    wave: z.number().optional(),
    convergence_seam_id: z.string().optional()
  }),
  planAssignWaves: z.object({
    assignments: z.array(z.object({
      plan_id: z.string(),
      wave: z.number()
    }))
  }),
  planNormalize: z.object({
    text: z.string(),
    source_kind: z.string().optional(),
    stage: z.string().optional(),
    mission_title: z.string().optional()
  }),
  taskCreate: z.object({
    mission_id: z.string(),
    plan_id: z.string().optional(),
    run_id: z.string().optional(),
    kind: z.string().optional(),
    status: z.enum(taskStateValues).optional(),
    assignee: z.string().optional(),
    checkpoint_ref: z.string().optional(),
    retry_count: z.number().optional(),
    blocking_reason: z.string().optional(),
    payload: looseRecord.optional()
  }),
  taskTransition: z.object({
    task_id: z.string(),
    status: z.enum(taskStateValues).optional(),
    checkpoint_ref: z.string().optional(),
    retry_count: z.number().optional(),
    blocking_reason: z.string().optional()
  }),
  taskList: z.object({
    mission_id: z.string().optional(),
    run_id: z.string().optional(),
    status: z.string().optional()
  }),
  taskResume: z.object({ task_id: z.string() }),
  runCreate: z.object({
    mission_id: z.string(),
    plan_ids: z.array(z.string()).optional(),
    mode: executorModeEnum.optional(),
    prompt: z.string().optional(),
    assignee: z.string().optional(),
    capabilities_used: z.array(z.string()).optional(),
    budget: looseRecord.optional(),
    a2a_agent_card_url: z.string().url().optional(),
    a2a_message: z.string().optional(),
    remote_task_id: z.string().optional(),
    remote_context_id: z.string().optional()
  }),
  runGet: z.object({ run_id: z.string() }),
  runList: z.object({ mission_id: z.string().optional() }),
  runResume: z.object({ run_id: z.string() }),
  runCancel: z.object({ run_id: z.string() }),
  evidenceRecord: z.object({
    mission_id: z.string(),
    run_id: z.string().optional(),
    type: z.string().optional(),
    source: z.string().optional(),
    result: z.string().optional(),
    artifact_ref: z.string().optional(),
    /** D7-w1: MCP executes plan verification_targets and stamps verified_by: mcp */
    run_oracles: z.boolean().optional(),
    /** D7-w2: bmo|roi — enforce paths_touched prefix and optional git porcelain cross-check */
    product_tree: z.enum(["bmo", "roi"]).optional(),
    content: looseRecord.optional()
  }),
  evidenceList: z.object({
    mission_id: z.string(),
    run_id: z.string().optional()
  }),
  traceRecord: z.object({
    mission_id: z.string(),
    run_id: z.string().optional(),
    task_id: z.string().optional(),
    events: z.array(z.string()).optional(),
    tool_calls: z.array(z.string()).optional(),
    latency_ms: z.number().optional(),
    token_usage: looseRecord.optional(),
    error_signals: z.array(z.string()).optional(),
    evaluation_refs: z.array(z.string()).optional()
  }),
  traceGet: z.object({ trace_id: z.string() }),
  traceList: z.object({
    mission_id: z.string(),
    run_id: z.string().optional()
  }),
  policyEvaluate: z.object({
    mission_id: z.string().optional(),
    run_id: z.string().optional(),
    task_id: z.string().optional(),
    subject: z.string().optional(),
    mode: z.string().optional()
  }),
  policyRecordDecision: z.object({
    id: z.string().optional(),
    mission_id: z.string().optional(),
    run_id: z.string().optional(),
    task_id: z.string().optional(),
    subject: z.string().optional(),
    decision: z.string().optional(),
    reason: z.string().optional(),
    policy_pack_ref: z.string().optional()
  }),
  protocolBind: z.object({
    mission_id: z.string().optional(),
    run_id: z.string().optional(),
    task_id: z.string().optional(),
    protocol: z.string().optional(),
    endpoint: z.string().optional(),
    auth_mode: z.string().optional(),
    artifact_contract: z.string().optional(),
    status: z.string().optional(),
    payload: looseRecord.optional()
  }),
  protocolListBindings: z.object({
    run_id: z.string().optional(),
    task_id: z.string().optional()
  }),
  capabilityRegister: z.object({
    mission_id: z.string().optional(),
    capability_id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(),
    triggers: z.array(z.string()).optional(),
    inputs: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    protocols: z.array(z.string()).optional(),
    policy_scope: z.string().optional(),
    matchers: looseRecord.optional(),
    workflow_template: z.array(z.enum(stageKindValues)).optional(),
    review_policy_refs: z.array(z.string()).optional(),
    executor_modes: executorModesArray.optional(),
    promotion_source: z.string().optional(),
    usage_count: z.number().optional(),
    effectiveness_score: z.number().optional(),
    payload: looseRecord.optional()
  }),
  capabilityMatch: z.object({
    mission_id: z.string(),
    plan_id: z.string().optional(),
    mode: executorModeEnum.optional()
  }),
  routeResolve: z.object({
    mission_id: z.string(),
    plan_id: z.string().optional(),
    mode: executorModeEnum.optional()
  }),
  routeList: z.object({
    mission_id: z.string().optional(),
    plan_id: z.string().optional(),
    capability_id: z.string().optional()
  }),
  activationCreate: z.object({
    mission_id: z.string(),
    run_id: z.string(),
    plan_id: z.string(),
    capability_id: z.string(),
    executor_mode: executorModeEnum,
    workflow_template: z.array(z.enum(stageKindValues)).optional()
  }),
  activationGet: z.object({ activation_id: z.string() }),
  activationList: z.object({
    mission_id: z.string().optional(),
    run_id: z.string().optional(),
    capability_id: z.string().optional()
  }),
  reviewRecord: z.object({
    mission_id: z.string(),
    run_id: z.string(),
    task_id: z.string(),
    activation_id: z.string().optional(),
    review_type: z.string(),
    subject_ref: z.string(),
    verdict: z.enum(reviewVerdictValues),
    blocking_issues: z.array(z.string()).optional(),
    evidence_refs: z.array(z.string()).optional(),
    trace_refs: z.array(z.string()).optional()
  }),
  reviewGet: z.object({ review_id: z.string() }),
  reviewList: z.object({
    mission_id: z.string().optional(),
    run_id: z.string().optional(),
    activation_id: z.string().optional()
  }),
  patternDetect: z.object({ mission_id: z.string() }),
  patternList: z.object({ mission_id: z.string() }),
  capabilityPropose: z.object({
    capability_id: z.string().optional(),
    mission_id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    triggers: z.array(z.string()).optional(),
    inputs: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    protocols: z.array(z.string()).optional(),
    policy_scope: z.string().optional(),
    matchers: looseRecord.optional(),
    workflow_template: z.array(z.enum(stageKindValues)).optional(),
    review_policy_refs: z.array(z.string()).optional(),
    executor_modes: executorModesArray.optional(),
    promotion_source: z.string().optional(),
    usage_count: z.number().optional(),
    effectiveness_score: z.number().optional(),
    payload: looseRecord.optional()
  }),
  capabilityPromote: z.object({
    capability_id: z.string(),
    name: z.string().optional(),
    type: z.string().optional(),
    triggers: z.array(z.string()).optional(),
    inputs: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    protocols: z.array(z.string()).optional(),
    policy_scope: z.string().optional(),
    matchers: looseRecord.optional(),
    workflow_template: z.array(z.enum(stageKindValues)).optional(),
    review_policy_refs: z.array(z.string()).optional(),
    executor_modes: executorModesArray.optional(),
    promotion_source: z.string().optional(),
    usage_count: z.number().optional(),
    effectiveness_score: z.number().optional(),
    payload: looseRecord.optional()
  }),
  capabilityList: z.object({ mission_id: z.string().optional() }),
  verifyEvaluate: z.object({
    run_id: z.string(),
    verdict: z.enum(verifyVerdictValues).optional(),
    notes: z.string().optional(),
    /** D7-w3: pass blocked unless run plans have mcp_verified substantive roi:go */
    require_verified_proof: z.boolean().optional(),
    /** Source-contract pass blocked unless marked run plans have independent_reviewed proof */
    require_independent_source_contract_review: z.boolean().optional(),
    /** D2-D: MCP runs plan verification_targets and stamps verify_gate on evidence */
    run_oracles: z.boolean().optional(),
    /** Checkpoint pass when at least one run plan has substantive roi:go but mission is incomplete */
    allow_partial_verification: z.boolean().optional()
  }),
  enlightenRun: z.object({ mission_id: z.string() }),
  statusGet: z.object({ mission_id: z.string() })
});
