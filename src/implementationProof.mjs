/**
 * Validation for roi:go verification evidence (D1 / D3 / D6 / D7).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareEvidenceChronological,
  qualityReviewInvalidatesPlan
} from "./missionVerificationPolicy.mjs";
import {
  CWD_WORKSPACE,
  CWD_PACKAGE,
  getProductTree,
  isProductTreeKey,
  productTreeKeys
} from "./productTrees.mjs";

export const IMPLEMENTATION_PROOF_TRUST_AGENT_CLAIMED = "agent_claimed";
export const IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED = "mcp_verified";
export const SOURCE_CONTRACT_CONFIDENCE_NONE = "none";
export const SOURCE_CONTRACT_CONFIDENCE_STRUCTURAL = "structural";
export const SOURCE_CONTRACT_CONFIDENCE_INDEPENDENT_REVIEWED = "independent_reviewed";

/** Trust level for a single roi:go verification row (D7). */
export function implementationProofTrust(evidence) {
  if (!evidence) {
    return IMPLEMENTATION_PROOF_TRUST_AGENT_CLAIMED;
  }
  const content =
    evidence.content && typeof evidence.content === "object" ? evidence.content : {};
  const proof =
    content.implementation_proof && typeof content.implementation_proof === "object"
      ? content.implementation_proof
      : {};
  const verifiedBy = String(proof.verified_by ?? content.verified_by ?? "").trim();
  if (verifiedBy === "mcp" || verifiedBy === IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED) {
    return IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED;
  }
  return IMPLEMENTATION_PROOF_TRUST_AGENT_CLAIMED;
}

export function planRevisionFromEvidence(evidence) {
  const content =
    evidence?.content && typeof evidence.content === "object" ? evidence.content : {};
  const raw = content.plan_revision ?? content.planRevision;
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  return Number(raw);
}

export function evidenceMatchesPlanRevision(evidence, plan) {
  if (!plan) {
    return true;
  }
  const evidenceRev = planRevisionFromEvidence(evidence);
  const planRev = Number(plan.revision ?? 1);
  if (evidenceRev === null) {
    return planRev === 1;
  }
  return evidenceRev === planRev;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const text = String(value ?? "").trim();
  return text ? [text] : [];
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function planRequiresSourceContractCheck(plan) {
  return (
    plan?.requires_source_contract_check === true ||
    normalizeStringArray(plan?.source_contract_refs).length > 0
  );
}

function isExternalEvidenceRef(ref) {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith("file:");
}

function isOpaqueEvidenceRef(ref) {
  return !ref.startsWith("file:") && /^[A-Za-z0-9_.:-]+$/.test(ref) && !ref.includes("/");
}

function sourceContractEvidencePathIssue(ref, workspaceRoot) {
  const proofRef = String(ref ?? "").trim();
  if (!proofRef || isExternalEvidenceRef(proofRef) || isOpaqueEvidenceRef(proofRef)) {
    return "";
  }
  const normalized = normalizeRepoRelativePath(proofRef);
  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    return `manual_review evidence must be a repo-relative path, URL, or artifact id: ${proofRef}`;
  }
  const root = String(workspaceRoot ?? "").trim();
  if (!root) {
    return "";
  }
  const parts = splitProductTreePath(normalized);
  const resolved = parts && isProductTreeKey(parts.treeKey, root)
    ? resolveTouchedPath(normalized, root)
    : path.resolve(resolveRoiPackageRoot(root), normalized);
  if (!fs.existsSync(resolved)) {
    return `manual_review evidence not found on disk: ${proofRef}`;
  }
  return "";
}

function sourceContractCoverageIssue(input, plan = null, options = {}) {
  if (!planRequiresSourceContractCheck(plan)) {
    return "";
  }
  const content = asPlainObject(input?.content ?? input);
  const proof = asPlainObject(content.implementation_proof);
  const sourceContract = asPlainObject(proof.source_contract ?? content.source_contract);
  if (!Object.keys(sourceContract).length) {
    return "missing implementation_proof.source_contract";
  }
  const sourceRefs = normalizeStringArray(sourceContract.source_refs ?? sourceContract.source_contract_refs);
  if (!sourceRefs.length) {
    return "source_contract.source_refs is empty";
  }
  const planSourceRefs = normalizeStringArray(plan?.source_contract_refs);
  const missingSourceRefs = planSourceRefs.filter((ref) => !sourceRefs.includes(ref));
  if (missingSourceRefs.length > 0) {
    return `source_contract.source_refs does not include plan.source_contract_refs: ${missingSourceRefs.join(", ")}`;
  }
  const planTargets = normalizeStringArray(plan?.verification_targets);
  const coverage = Array.isArray(sourceContract.coverage) ? sourceContract.coverage : [];
  if (!coverage.length) {
    return "source_contract.coverage is empty";
  }
  for (const [index, entry] of coverage.entries()) {
    const row = asPlainObject(entry);
    const requirement = String(row.requirement ?? row.source_requirement ?? "").trim();
    const disposition = String(row.disposition ?? "").trim();
    if (!requirement) {
      return `source_contract.coverage[${index}] is missing requirement`;
    }
    if (!["verification_target", "manual_review", "not_applicable"].includes(disposition)) {
      return `source_contract.coverage[${index}] has invalid disposition`;
    }
    if (disposition === "verification_target") {
      const target = String(row.verification_target ?? row.oracle ?? "").trim();
      if (!target) {
        return `source_contract.coverage[${index}] is missing verification_target`;
      }
      if (!planTargets.length) {
        return `source_contract.coverage[${index}] uses verification_target but plan.verification_targets is empty`;
      }
      if (!planTargets.includes(target)) {
        return `source_contract.coverage[${index}] verification_target is not in plan.verification_targets`;
      }
    }
    if (disposition === "manual_review") {
      const proofRef = String(row.evidence ?? row.proof ?? "").trim();
      if (!proofRef) {
        return `source_contract.coverage[${index}] is missing evidence`;
      }
      const evidenceIssue = sourceContractEvidencePathIssue(proofRef, options.workspaceRoot);
      if (evidenceIssue) {
        return `source_contract.coverage[${index}] ${evidenceIssue}`;
      }
    }
    if (disposition === "not_applicable") {
      const reason = String(row.reason ?? "").trim();
      if (!reason) {
        return `source_contract.coverage[${index}] is missing reason`;
      }
    }
  }
  return "";
}

export function sourceContractCoveragePresent(input, plan = null, options = {}) {
  return !sourceContractCoverageIssue(input, plan, options);
}

function sourceContractFromEvidence(evidence) {
  const content = asPlainObject(evidence?.content ?? evidence);
  const proof = asPlainObject(content.implementation_proof);
  return asPlainObject(proof.source_contract ?? content.source_contract);
}

function independentReviewMetadataPresent(evidence) {
  const sourceContract = sourceContractFromEvidence(evidence);
  const review = asPlainObject(sourceContract.independent_review ?? sourceContract.review);
  const mode = String(review.mode ?? sourceContract.review_mode ?? "").trim();
  const reviewer = String(review.reviewer ?? review.reviewed_by ?? sourceContract.reviewed_by ?? "").trim();
  const proofRef = String(
    review.evidence ?? review.artifact_ref ?? review.proof ?? sourceContract.review_evidence ?? ""
  ).trim();
  return ["independent", "independent_review", "independent_reviewed"].includes(mode) &&
    Boolean(reviewer) &&
    Boolean(proofRef);
}

export function sourceContractProofConfidence(evidence, plan = null, options = {}) {
  if (!planRequiresSourceContractCheck(plan)) {
    return SOURCE_CONTRACT_CONFIDENCE_NONE;
  }
  if (!sourceContractCoveragePresent(evidence, plan, options)) {
    return SOURCE_CONTRACT_CONFIDENCE_NONE;
  }
  return independentReviewMetadataPresent(evidence)
    ? SOURCE_CONTRACT_CONFIDENCE_INDEPENDENT_REVIEWED
    : SOURCE_CONTRACT_CONFIDENCE_STRUCTURAL;
}

/** Workspace root for agent-cli container (parent of `roi/`). */
export function defaultRoiWorkspaceRoot() {
  const packageRoot = defaultRoiPackageRoot();
  return path.basename(packageRoot) === "roi"
    ? path.resolve(packageRoot, "..")
    : packageRoot;
}

export function defaultRoiPackageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

function looksLikeRoiPackageRoot(candidate) {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "scripts", "lifecycle.mjs")) &&
    fs.existsSync(path.join(candidate, "src", "service.mjs"))
  );
}

export function resolveRoiPackageRoot(workspaceRoot = defaultRoiWorkspaceRoot()) {
  const root = path.resolve(String(workspaceRoot || "").trim() || ".");
  const candidates = [path.join(root, "roi"), root];
  for (const candidate of candidates) {
    if (looksLikeRoiPackageRoot(candidate)) {
      return candidate;
    }
  }
  return path.join(root, "roi");
}

export function resolveProductTreeRoot(productTree, workspaceRoot = defaultRoiWorkspaceRoot()) {
  const key = String(productTree ?? "").trim().toLowerCase();
  const root = path.resolve(String(workspaceRoot || "").trim() || ".");
  if (key === "roi") {
    return resolveRoiPackageRoot(root);
  }
  if (key === "bmo") {
    return path.basename(root) === "bmo" ? root : path.join(root, "bmo");
  }
  const tree = getProductTree(key, root);
  if (tree) {
    return path.basename(root) === tree.subdir ? root : path.join(root, tree.subdir);
  }
  return root;
}

function splitProductTreePath(relPath) {
  const normalized = normalizeRepoRelativePath(relPath);
  const slash = normalized.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  return {
    treeKey: normalized.slice(0, slash),
    productRelativePath: normalized.slice(slash + 1)
  };
}

export function resolveTouchedPath(relPath, workspaceRoot = defaultRoiWorkspaceRoot()) {
  const parts = splitProductTreePath(relPath);
  if (!parts) {
    return path.resolve(workspaceRoot, normalizeRepoRelativePath(relPath));
  }
  return path.resolve(
    resolveProductTreeRoot(parts.treeKey, workspaceRoot),
    parts.productRelativePath
  );
}

export function porcelainPathForTouched(relPath, workspaceRoot = defaultRoiWorkspaceRoot()) {
  return normalizeRepoRelativePath(
    path.relative(workspaceRoot, resolveTouchedPath(relPath, workspaceRoot))
  );
}

export function oracleRunRecordPresent(proof, plan) {
  if (!plan) {
    return true;
  }
  const targets = Array.isArray(plan.verification_targets) ? plan.verification_targets : [];
  if (!targets.length) {
    return true;
  }
  const oraclesRun = Array.isArray(proof.oracles_run) ? proof.oracles_run : [];
  return oraclesRun.some((entry) => {
    if (typeof entry === "string") {
      return entry.trim().length > 0;
    }
    if (entry && typeof entry === "object") {
      return String(entry.cmd ?? entry.command ?? "").trim().length > 0;
    }
    return false;
  });
}

/** Infer product tree from plan targets/actions (D7-w2). */
export function inferProductTreeKey(plan, workspaceRoot = defaultRoiWorkspaceRoot()) {
  const blob = [
    ...(Array.isArray(plan?.verification_targets) ? plan.verification_targets : []),
    ...(Array.isArray(plan?.actions) ? plan.actions : [])
  ].join(" ");
  if (/\bbmo\//.test(blob) || blob.includes("cd bmo")) {
    return "bmo";
  }
  // Registry-defined trees: match `cd <subdir>` or a `<subdir>/` path fragment
  // in the plan text. Built-ins (roi/bmo) are handled above / below.
  for (const key of productTreeKeys(workspaceRoot)) {
    if (key === "roi" || key === "bmo") {
      continue;
    }
    const tree = getProductTree(key, workspaceRoot);
    const subdir = tree?.subdir ?? key;
    if (
      new RegExp(`(^|\\s)cd\\s+${escapeRegExp(subdir)}(\\s|$|/|&)`).test(blob) ||
      blob.includes(`${subdir}/`)
    ) {
      return key;
    }
  }
  return "roi";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inferProductTreeKeyFromPaths(paths, workspaceRoot = defaultRoiWorkspaceRoot()) {
  const keys = productTreeKeys(workspaceRoot);
  for (const touched of paths ?? []) {
    const parts = splitProductTreePath(normalizeRepoRelativePath(touched));
    if (parts && keys.has(parts.treeKey)) {
      return parts.treeKey;
    }
  }
  return null;
}

export function resolveProductTreeKey(
  plan,
  explicitProductTree,
  paths = [],
  workspaceRoot = defaultRoiWorkspaceRoot()
) {
  const explicit = String(explicitProductTree ?? "").trim().toLowerCase();
  if (explicit) {
    if (!isProductTreeKey(explicit, workspaceRoot)) {
      const known = [...productTreeKeys(workspaceRoot)].sort().join(", ");
      throw new Error(
        `product_tree must be one of: ${known} — got: ${explicitProductTree}`
      );
    }
    return explicit;
  }
  if (plan) {
    return inferProductTreeKey(plan, workspaceRoot);
  }
  const fromPaths = inferProductTreeKeyFromPaths(paths, workspaceRoot);
  if (fromPaths) {
    return fromPaths;
  }
  return "roi";
}

export function normalizeRepoRelativePath(touched) {
  return String(touched).trim().replace(/\\/g, "/");
}

export function pathAppearsInPorcelain(
  relPath,
  porcelainLines,
  workspaceRoot = defaultRoiWorkspaceRoot()
) {
  const norm = porcelainPathForTouched(relPath, workspaceRoot);
  return (porcelainLines ?? []).some((line) => {
    const file = normalizeRepoRelativePath(String(line).slice(3));
    return file === norm;
  });
}

export function gitPorcelainLines(workspaceRoot) {
  const root = String(workspaceRoot ?? "").trim();
  if (!root) {
    return [];
  }
  try {
    return execSync("git status --porcelain", {
      cwd: root,
      encoding: "utf8"
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function validatePathsTouchedOnDisk(
  proof,
  { workspaceRoot, plan, productTree, porcelainCheck } = {}
) {
  const root = String(workspaceRoot ?? "").trim();
  if (!root) {
    return;
  }
  const paths = Array.isArray(proof.paths_touched)
    ? proof.paths_touched.map((p) => String(p).trim()).filter(Boolean)
    : [];
  if (!paths.length) {
    return;
  }

  for (const touched of paths) {
    const normalized = normalizeRepoRelativePath(touched);
    if (path.isAbsolute(normalized)) {
      throw new Error(`roi:go verification pass paths_touched must be workspace-relative: ${touched}`);
    }
    const parts = splitProductTreePath(normalized);
    const treeKey = parts?.treeKey ?? "";
    const isKnownProductTree = isProductTreeKey(treeKey, root);
    const productRoot = isKnownProductTree ? resolveProductTreeRoot(treeKey, root) : root;
    // Resolve-then-contain: known product trees keep their rooted containment,
    // while sibling workspace projects (for example `benchmarks/`) are allowed
    // as long as they stay inside the workspace root.
    const resolved = isKnownProductTree
      ? resolveTouchedPath(normalized, root)
      : path.resolve(root, normalized);
    const rel = path.relative(productRoot, resolved);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `roi:go verification pass paths_touched escapes the workspace root: ${touched}`
      );
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`roi:go verification pass paths_touched not found on disk: ${touched}`);
    }
  }

  if (porcelainCheck) {
    const treeKey = resolveProductTreeKey(plan, productTree, paths, root);
    const treePrefix = `${treeKey}/`;
    const porcelainLines = gitPorcelainLines(root);
    if (porcelainLines === null) {
      throw new Error(
        "roi:go verification pass product_tree porcelain check failed: git status unavailable"
      );
    }
    for (const touched of paths) {
      const normalized = normalizeRepoRelativePath(touched);
      if (!normalized.startsWith(treePrefix)) {
        throw new Error(
          `roi:go verification pass product_tree ${treeKey} requires paths under ${treePrefix}: ${touched}`
        );
      }
      if (!pathAppearsInPorcelain(touched, porcelainLines, root)) {
        throw new Error(
          `roi:go verification pass paths_touched not in git porcelain for product_tree ${treeKey}: ${touched}`
        );
      }
    }
  }
}

/** D7-w3: every run plan_id has substantive roi:go with verified_by mcp. */
export function runPlansHaveMcpVerifiedGoEvidence(plans, evidenceList, planIds) {
  const ids = new Set((planIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  if (!ids.size) {
    return false;
  }
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  for (const plan of plans ?? []) {
    if (!ids.has(plan.id)) {
      continue;
    }
    const latest = byPlan.get(plan.id);
    if (!isSubstantiveRoiGoVerification(latest, plan, { evidenceList })) {
      return false;
    }
    if (implementationProofTrust(latest) !== IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED) {
      return false;
    }
  }
  return true;
}

function sourceContractPlansInScope(plans, options = {}) {
  return inScopePlans(plans, options).filter((plan) => planRequiresSourceContractCheck(plan));
}

export function runPlansHaveIndependentSourceContractReview(plans, evidenceList, planIds) {
  const scoped = sourceContractPlansInScope(plans, { planIds });
  if (!scoped.length) {
    return true;
  }
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  for (const plan of scoped) {
    const latest = byPlan.get(plan.id);
    if (!isSubstantiveRoiGoVerification(latest, plan, { evidenceList })) {
      return false;
    }
    if (
      sourceContractProofConfidence(latest, plan) !==
      SOURCE_CONTRACT_CONFIDENCE_INDEPENDENT_REVIEWED
    ) {
      return false;
    }
  }
  return true;
}

/** require_independent_source_contract_review with allow_partial_verification. */
export function runPlansHaveIndependentSourceContractReviewForSubstantive(plans, evidenceList, planIds) {
  const checkpoint = partialVerificationCheckpoint(plans, evidenceList, planIds);
  if (!checkpoint.substantive_plan_ids.length) {
    return false;
  }
  const runScopedSourceContractPlans = sourceContractPlansInScope(plans, { planIds });
  const substantiveSourceContractPlans = sourceContractPlansInScope(plans, {
    planIds: checkpoint.substantive_plan_ids
  });
  if (!substantiveSourceContractPlans.length) {
    return runScopedSourceContractPlans.length === 0;
  }
  return runPlansHaveIndependentSourceContractReview(
    plans,
    evidenceList,
    checkpoint.substantive_plan_ids
  );
}

export function missionSourceContractProofConfidence(plans, evidenceList, options = {}) {
  const scoped = sourceContractPlansInScope(plans, options);
  if (!scoped.length) {
    return SOURCE_CONTRACT_CONFIDENCE_NONE;
  }
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  let sawStructural = false;
  for (const plan of scoped) {
    const latest = byPlan.get(plan.id);
    if (!isSubstantiveRoiGoVerification(latest, plan, { evidenceList })) {
      return SOURCE_CONTRACT_CONFIDENCE_NONE;
    }
    const confidence = sourceContractProofConfidence(latest, plan);
    if (confidence !== SOURCE_CONTRACT_CONFIDENCE_INDEPENDENT_REVIEWED) {
      sawStructural = confidence === SOURCE_CONTRACT_CONFIDENCE_STRUCTURAL || sawStructural;
    }
  }
  return sawStructural
    ? SOURCE_CONTRACT_CONFIDENCE_STRUCTURAL
    : SOURCE_CONTRACT_CONFIDENCE_INDEPENDENT_REVIEWED;
}

export function validateRoiGoVerificationPass(input, { plan } = {}, options = {}) {
  const result = String(input.result ?? "")
    .trim()
    .toLowerCase();
  const source = String(input.source ?? "").trim();
  const type = String(input.type ?? "note").trim();
  if (source !== "roi:go" || type !== "verification" || result !== "pass") {
    return;
  }

  const content =
    input.content && typeof input.content === "object" ? input.content : {};
  const proof =
    content.implementation_proof && typeof content.implementation_proof === "object"
      ? content.implementation_proof
      : {};
  const planId = String(content.plan_id ?? content.planId ?? "").trim();

  if (plan && !planId) {
    throw new Error("roi:go verification pass requires content.plan_id");
  }
  if (plan && planId && plan.id !== planId) {
    throw new Error(`roi:go verification pass plan_id ${planId} does not match plan ${plan.id}`);
  }

  const verifyOnly = content.verify_only_plan === true || proof.verify_only_plan === true;
  const actions = plan ? (Array.isArray(plan.actions) ? plan.actions : []) : [];
  const targets = plan ? (Array.isArray(plan.verification_targets) ? plan.verification_targets : []) : [];

  if (verifyOnly) {
    if (plan && actions.length > 0) {
      throw new Error("verify_only_plan is not allowed when plan has implementation actions");
    }
    if (targets.length > 0 && proof.oracles_ok !== true) {
      throw new Error("roi:go verify-only pass requires implementation_proof.oracles_ok: true");
    }
    const sourceContractIssue = sourceContractCoverageIssue({ content }, plan, options);
    if (sourceContractIssue) {
      throw new Error(`roi:go verification pass requires source contract coverage: ${sourceContractIssue}`);
    }
    return;
  }

  if (proof.oracles_ok !== true) {
    throw new Error("roi:go verification pass requires implementation_proof.oracles_ok: true");
  }

  const diffStat = String(proof.diff_stat ?? "").trim();
  const paths = Array.isArray(proof.paths_touched)
    ? proof.paths_touched.filter((p) => String(p).trim())
    : [];
  if (!diffStat && paths.length === 0) {
    throw new Error(
      "roi:go verification pass requires implementation_proof.diff_stat or paths_touched"
    );
  }

  if (plan && targets.length > 0 && !oracleRunRecordPresent(proof, plan)) {
    throw new Error(
      "roi:go verification pass requires non-empty implementation_proof.oracles_run when plan has verification_targets"
    );
  }

  const sourceContractIssue = sourceContractCoverageIssue({ content }, plan, options);
  if (sourceContractIssue) {
    throw new Error(`roi:go verification pass requires source contract coverage: ${sourceContractIssue}`);
  }

  validatePathsTouchedOnDisk(proof, {
    workspaceRoot: options.workspaceRoot,
    plan: options.plan ?? plan,
    productTree: options.productTree,
    porcelainCheck: options.porcelainCheck
  });
}

export function verifyGateNextActions(verdict, options) {
  const opts = typeof options === "string" ? {} : options ?? {};
  if (verdict === "pass") {
    if (opts.partialCheckpoint === true) {
      return ["roi:go", "roi:inspect"];
    }
    return ["roi:publish", "roi:learn"];
  }
  return ["roi:go", "roi:edit", "roi:inspect"];
}

function runScopedPlans(plans, planIds) {
  const ids = new Set((planIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  if (!ids.size) {
    return plans ?? [];
  }
  return (plans ?? []).filter((plan) => ids.has(plan.id));
}

/**
 * Partial-checkpoint eligibility for verify.evaluate(allow_partial_verification).
 * `partial_checkpoint` is true when some but not all run-scoped plans have substantive roi:go.
 */
export function partialVerificationCheckpoint(plans, evidenceList, runPlanIds) {
  const scoped = runScopedPlans(plans, runPlanIds);
  const progress = missionGoProgress(scoped, evidenceList);
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  const substantivePlanIds = [];
  for (const plan of scoped) {
    if (isSubstantiveRoiGoVerification(byPlan.get(plan.id), plan, { evidenceList })) {
      substantivePlanIds.push(plan.id);
    }
  }
  const allowed = progress.substantive >= 1;
  const partialCheckpoint = allowed && !progress.complete;
  return {
    allowed,
    partial_checkpoint: partialCheckpoint,
    substantive_count: progress.substantive,
    open_count: progress.open.length,
    total: progress.total,
    mission_complete: progress.complete,
    substantive_plan_ids: substantivePlanIds,
    open_plans: progress.open.map((entry) => ({
      plan_id: entry.plan_id,
      plan_name: entry.plan_name,
      wave: entry.wave,
      reason: entry.reason
    }))
  };
}

/** Read-only hint for status_get — checkpoint pass is available but mission is incomplete. */
export function partialVerificationEligible(plans, evidenceList, options = {}) {
  const progress = missionGoProgress(plans, evidenceList, options);
  return {
    eligible: progress.substantive >= 1 && !progress.complete,
    substantive_count: progress.substantive,
    open_count: progress.open.length,
    total: progress.total,
    mission_complete: progress.complete
  };
}

/** require_verified_proof with allow_partial_verification: only substantive run plans must be MCP-verified. */
export function runPlansHaveMcpVerifiedGoEvidenceForSubstantive(plans, evidenceList, planIds) {
  const checkpoint = partialVerificationCheckpoint(plans, evidenceList, planIds);
  if (!checkpoint.substantive_plan_ids.length) {
    return false;
  }
  return runPlansHaveMcpVerifiedGoEvidence(plans, evidenceList, checkpoint.substantive_plan_ids);
}

export function isLocalImplementStubOutput(output) {
  const text = String(output ?? "").trim();
  return text.startsWith("LOCAL_EXECUTION_COMPLETED");
}

export function isHostImplementHandoffOutput(output) {
  const text = String(output ?? "").trim();
  if (text.startsWith("AGENT_IMPLEMENT_HANDOFF")) {
    return true;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed?.kind === "AGENT_IMPLEMENT_HANDOFF";
  } catch {
    return false;
  }
}

function planIdFromEvidence(evidence) {
  const content =
    evidence?.content && typeof evidence.content === "object" ? evidence.content : {};
  return String(content.plan_id ?? content.planId ?? "").trim();
}

/** Latest roi:go verification row per plan_id (newest captured_at wins). */
export function latestRoiGoVerificationByPlan(evidenceList) {
  const byPlan = new Map();
  const sorted = [...(evidenceList ?? [])].sort((a, b) => compareEvidenceChronological(b, a));
  for (const evidence of sorted) {
    const source = String(evidence.source ?? "").trim();
    const type = String(evidence.type ?? "").trim();
    if (source !== "roi:go" || type !== "verification") {
      continue;
    }
    const planId = planIdFromEvidence(evidence);
    if (!planId || byPlan.has(planId)) {
      continue;
    }
    byPlan.set(planId, evidence);
  }
  return byPlan;
}

function isVerifyOnlyEvidence(evidence, plan) {
  const content =
    evidence?.content && typeof evidence.content === "object" ? evidence.content : {};
  const proof =
    content.implementation_proof && typeof content.implementation_proof === "object"
      ? content.implementation_proof
      : {};
  const flagged = content.verify_only_plan === true || proof.verify_only_plan === true;
  if (!plan) {
    return flagged;
  }
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  return flagged && actions.length === 0;
}

/** Pass with implementation_proof.oracles_ok and diff or paths (matches MCP pass guard). */
export function isSubstantiveRoiGoVerification(evidence, plan = null, options = {}) {
  if (!evidence) {
    return false;
  }
  const evidenceList = options.evidenceList ?? null;
  const planIdForReopen =
    plan?.id ?? String(evidence.content?.plan_id ?? evidence.content?.planId ?? "").trim();
  if (evidenceList && planIdForReopen && qualityReviewInvalidatesPlan(evidenceList, planIdForReopen)) {
    return false;
  }
  const source = String(evidence.source ?? "").trim();
  const type = String(evidence.type ?? "").trim();
  const result = String(evidence.result ?? "")
    .trim()
    .toLowerCase();
  if (source !== "roi:go" || type !== "verification" || result !== "pass") {
    return false;
  }
  if (plan && !evidenceMatchesPlanRevision(evidence, plan)) {
    return false;
  }

  if (isVerifyOnlyEvidence(evidence, plan)) {
    const proof =
      evidence.content?.implementation_proof && typeof evidence.content.implementation_proof === "object"
        ? evidence.content.implementation_proof
        : {};
    const targets = plan ? (Array.isArray(plan.verification_targets) ? plan.verification_targets : []) : [];
    if (targets.length > 0 && proof.oracles_ok !== true) {
      return false;
    }
    if (!sourceContractCoveragePresent(evidence, plan)) {
      return false;
    }
    return true;
  }

  const content =
    evidence.content && typeof evidence.content === "object" ? evidence.content : {};
  const proof =
    content.implementation_proof && typeof content.implementation_proof === "object"
      ? content.implementation_proof
      : {};
  if (proof.oracles_ok !== true) {
    return false;
  }
  const diffStat = String(proof.diff_stat ?? "").trim();
  const paths = Array.isArray(proof.paths_touched)
    ? proof.paths_touched.filter((p) => String(p).trim())
    : [];
  if (!diffStat && paths.length === 0) {
    return false;
  }
  return sourceContractCoveragePresent(evidence, plan);
}

export function planDependenciesMet(plan, plans, evidenceList, options = {}) {
  const deps = Array.isArray(plan.dependencies) ? plan.dependencies : [];
  if (!deps.length) {
    return true;
  }
  const skip = new Set((options.skipPlanIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const byId = new Map((plans ?? []).map((candidate) => [candidate.id, candidate]));
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  for (const depRef of deps) {
    const depId = String(depRef ?? "").trim();
    if (!depId || skip.has(depId)) {
      continue;
    }
    const depPlan = byId.get(depId);
    if (!depPlan) {
      continue;
    }
    if (!isSubstantiveRoiGoVerification(byPlan.get(depPlan.id), depPlan, { evidenceList })) {
      return false;
    }
  }
  return true;
}

function planNeedsSubstantiveGo(plan, byPlan, evidenceList) {
  const targets = Array.isArray(plan.verification_targets) ? plan.verification_targets : [];
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  if (!targets.length && !actions.length) {
    return false;
  }
  const latest = byPlan.get(plan.id);
  return !latest || !isSubstantiveRoiGoVerification(latest, plan, { evidenceList });
}

/**
 * True when any in-scope plan with work targets lacks a substantive roi:go pass.
 * @param {{ skipPlanIds?: string[] }} [options] — omit delivered / out-of-scope plans (e.g. convergence seams already published)
 */
export function missionNeedsRoiGo(plans, evidenceList, options = {}) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return false;
  }
  const skip = new Set((options.skipPlanIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const planIds =
    Array.isArray(options.planIds) && options.planIds.length
      ? new Set(options.planIds.map((id) => String(id).trim()).filter(Boolean))
      : null;
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  for (const plan of plans) {
    if (skip.has(plan.id)) {
      continue;
    }
    if (planIds && !planIds.has(plan.id)) {
      continue;
    }
    if (planNeedsSubstantiveGo(plan, byPlan, evidenceList)) {
      return true;
    }
  }
  return false;
}

function inScopePlans(plans, options = {}) {
  const skip = new Set((options.skipPlanIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const planIds =
    Array.isArray(options.planIds) && options.planIds.length
      ? new Set(options.planIds.map((id) => String(id).trim()).filter(Boolean))
      : null;
  return (plans ?? []).filter((plan) => {
    if (skip.has(plan.id)) {
      return false;
    }
    if (planIds && !planIds.has(plan.id)) {
      return false;
    }
    const targets = Array.isArray(plan.verification_targets) ? plan.verification_targets : [];
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    return targets.length > 0 || actions.length > 0;
  });
}

/** Substantive roi:go verification for a single plan_id (uses latest plan revision when plans provided). */
export function substantiveRoiGoForPlan(evidenceList, planId, plans = null) {
  const id = String(planId ?? "").trim();
  if (!id) {
    return false;
  }
  const plan = Array.isArray(plans) ? plans.find((candidate) => candidate.id === id) ?? null : null;
  return isSubstantiveRoiGoVerification(latestRoiGoVerificationByPlan(evidenceList).get(id), plan, {
    evidenceList
  });
}

/** Per-plan work-track progress for drive / go completion loops. */
export function missionGoProgress(plans, evidenceList, options = {}) {
  const scoped = inScopePlans(plans, options);
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  const open = [];
  let substantive = 0;
  for (const plan of scoped) {
    const latest = byPlan.get(plan.id);
    if (isSubstantiveRoiGoVerification(latest, plan, { evidenceList })) {
      substantive += 1;
      continue;
    }
    let reason = "proof_not_substantive";
    if (!latest) {
      reason = "no_roi_go_verification";
    } else if (!evidenceMatchesPlanRevision(latest, plan)) {
      reason = "stale_plan_revision";
    } else if (String(latest.result ?? "").toLowerCase() === "fail") {
      reason = "verification_fail";
    } else if (!sourceContractCoveragePresent(latest, plan)) {
      reason = "source_contract_not_represented";
    }
    open.push({
      plan_id: plan.id,
      wave: Number(plan.wave ?? 1),
      plan_name: String(plan.name ?? "").trim(),
      reason
    });
  }
  return {
    total: scoped.length,
    substantive,
    open,
    complete: open.length === 0
  };
}

/** Mission-level trust: mcp_verified only when every in-scope substantive pass is MCP-verified. */
export function missionImplementationProofTrust(plans, evidenceList, options = {}) {
  const scoped = inScopePlans(plans, options);
  if (!scoped.length) {
    return IMPLEMENTATION_PROOF_TRUST_AGENT_CLAIMED;
  }
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  let sawSubstantive = false;
  for (const plan of scoped) {
    const latest = byPlan.get(plan.id);
    if (!isSubstantiveRoiGoVerification(latest, plan, { evidenceList })) {
      return IMPLEMENTATION_PROOF_TRUST_AGENT_CLAIMED;
    }
    sawSubstantive = true;
    if (implementationProofTrust(latest) !== IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED) {
      return IMPLEMENTATION_PROOF_TRUST_AGENT_CLAIMED;
    }
  }
  return sawSubstantive ? IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED : IMPLEMENTATION_PROOF_TRUST_AGENT_CLAIMED;
}

const REVIEW_ISSUES_SATISFIED_BY_ROI_GO = new Set([
  "local_implement_stub_only",
  "missing_execution_evidence",
  "verification_targets_not_represented"
]);

/** Filter spec/quality review blocking issues when mission roi:go proof exists for the plan. */
export function filterReviewBlockingIssues(blockingIssues, { roiGoSatisfied = false } = {}) {
  if (!roiGoSatisfied) {
    return [...(blockingIssues ?? [])];
  }
  return (blockingIssues ?? []).filter((issue) => !REVIEW_ISSUES_SATISFIED_BY_ROI_GO.has(issue));
}

function handoffReasonForPlan(plan, latest) {
  if (!latest) {
    return "no_roi_go_verification";
  }
  if (!evidenceMatchesPlanRevision(latest, plan)) {
    return "stale_plan_revision";
  }
  if (String(latest.result ?? "").toLowerCase() === "fail") {
    return "verification_fail";
  }
  return "proof_not_substantive";
}

/** First in-scope plan (lowest wave, dependencies met) that still needs a substantive roi:go pass. */
export function selectGoHandoffTarget(plans, evidenceList, options = {}) {
  if (!missionNeedsRoiGo(plans, evidenceList, options)) {
    return null;
  }
  const skip = new Set((options.skipPlanIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  const byPlan = latestRoiGoVerificationByPlan(evidenceList);
  const sorted = [...plans].sort((a, b) => Number(a.wave ?? 1) - Number(b.wave ?? 1));

  for (const plan of sorted) {
    if (skip.has(plan.id) || !planNeedsSubstantiveGo(plan, byPlan)) {
      continue;
    }
    if (!planDependenciesMet(plan, plans, evidenceList, options)) {
      continue;
    }
    return {
      plan_id: plan.id,
      wave: Number(plan.wave ?? 1),
      plan_name: String(plan.name ?? "").trim(),
      reason: handoffReasonForPlan(plan, byPlan.get(plan.id))
    };
  }

  for (const plan of sorted) {
    if (skip.has(plan.id) || !planNeedsSubstantiveGo(plan, byPlan)) {
      continue;
    }
    return {
      plan_id: plan.id,
      wave: Number(plan.wave ?? 1),
      plan_name: String(plan.name ?? "").trim(),
      reason: "blocked_unmet_dependencies"
    };
  }

  return null;
}

export function pausedRunNextActions({ needsGo = false, blocked = false } = {}) {
  if (blocked) {
    return ["roi:inspect"];
  }
  if (needsGo) {
    return ["roi:go", "roi:edit", "roi:inspect"];
  }
  return ["roi:edit", "roi:inspect"];
}
