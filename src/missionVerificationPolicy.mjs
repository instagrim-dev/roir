/**
 * Mission-level verification policy (strict vs default) derived from brief text.
 * Closes the agent_claimed graduation gap surfaced in MCP Wave 2 / Domain 9 runs.
 */

export const MISSION_VERIFY_POLICY_DEFAULT = "default";
export const MISSION_VERIFY_POLICY_STRICT = "strict";

const EXPLICIT_STRICT = /^verification_policy:\s*strict\b/i;
const EXPLICIT_DEFAULT = /^verification_policy:\s*default\b/i;

const STRICT_HINT =
  /graduation_mode:|a-grade-domain|a-grade domain|ax→5|ax->5|maturity iteration|maturity_iteration|row a closure|ax→5 stretch/i;

function constraintLines(brief) {
  if (!brief || typeof brief !== "object") {
    return [];
  }
  return (Array.isArray(brief.constraints) ? brief.constraints : []).map((line) =>
    String(line).trim()
  );
}

/** Resolve verification_policy from the latest brief revision. */
export function missionVerificationPolicyFromBrief(brief) {
  for (const line of constraintLines(brief)) {
    if (EXPLICIT_STRICT.test(line)) {
      return MISSION_VERIFY_POLICY_STRICT;
    }
    if (EXPLICIT_DEFAULT.test(line)) {
      return MISSION_VERIFY_POLICY_DEFAULT;
    }
  }
  for (const line of constraintLines(brief)) {
    if (STRICT_HINT.test(line)) {
      return MISSION_VERIFY_POLICY_STRICT;
    }
  }
  const problem = String(brief?.problem ?? "").trim();
  if (STRICT_HINT.test(problem)) {
    return MISSION_VERIFY_POLICY_STRICT;
  }
  return MISSION_VERIFY_POLICY_DEFAULT;
}

export function missionRequiresHelperVerifiedProof(brief) {
  return missionVerificationPolicyFromBrief(brief) === MISSION_VERIFY_POLICY_STRICT;
}

/** Block agent-claimed roi:go pass on strict missions unless run_oracles is true. */
export function validateStrictMissionGoEvidence(input, brief) {
  if (!missionRequiresHelperVerifiedProof(brief)) {
    return;
  }
  const result = String(input?.result ?? "")
    .trim()
    .toLowerCase();
  const source = String(input?.source ?? "").trim();
  const type = String(input?.type ?? "note").trim();
  if (source !== "roi:go" || type !== "verification" || result !== "pass") {
    return;
  }
  if (input?.run_oracles === true) {
    return;
  }
  throw new Error(
    "evidence_record blocked: mission verification_policy is strict; pass run_oracles: true on roi:go verification evidence (or set verification_policy: default on the brief)"
  );
}

/**
 * Reject copy-pasted implementation_proof bundles across different plans unless
 * shared_bundle is explicitly acknowledged.
 */
export function validatePerPlanProofDistinctness({ content, evidenceList, planId }) {
  const proof =
    content?.implementation_proof && typeof content.implementation_proof === "object"
      ? content.implementation_proof
      : null;
  if (!proof || proof.shared_bundle === true) {
    return;
  }
  const diffStat = String(proof.diff_stat ?? "").trim();
  if (!diffStat) {
    return;
  }
  const pathsKey = Array.isArray(proof.paths_touched)
    ? [...proof.paths_touched].map((p) => String(p).trim()).filter(Boolean).sort().join("\0")
    : "";
  const myPlanId = String(planId ?? content?.plan_id ?? "").trim();
  for (const ev of evidenceList ?? []) {
    if (String(ev.source ?? "").trim() !== "roi:go") {
      continue;
    }
    if (String(ev.type ?? "").trim() !== "verification") {
      continue;
    }
    const otherPlanId = String(ev.content?.plan_id ?? "").trim();
    if (!otherPlanId || otherPlanId === myPlanId) {
      continue;
    }
    const otherProof = ev.content?.implementation_proof ?? {};
    if (String(otherProof.diff_stat ?? "").trim() !== diffStat) {
      continue;
    }
    const otherPathsKey = Array.isArray(otherProof.paths_touched)
      ? [...otherProof.paths_touched].map((p) => String(p).trim()).filter(Boolean).sort().join("\0")
      : "";
    if (otherPathsKey === pathsKey) {
      throw new Error(
        `evidence_record blocked: duplicate implementation_proof for plan ${myPlanId} (same diff_stat and paths_touched as plan ${otherPlanId}); scope paths per plan or set implementation_proof.shared_bundle: true when intentional`
      );
    }
  }
}

/** Canonical sort/compare timestamp for evidence rows (SQLite uses captured_at). */
export function evidenceTimestamp(evidence) {
  return String(evidence?.captured_at ?? evidence?.created_at ?? "").trim();
}

function evidenceSequence(evidence) {
  const raw = evidence?.sequence ?? evidence?.captured_sequence;
  const seq = Number(raw);
  return Number.isFinite(seq) ? seq : null;
}

export function compareEvidenceChronological(a, b) {
  const timeCmp = evidenceTimestamp(a).localeCompare(evidenceTimestamp(b));
  if (timeCmp !== 0) {
    return timeCmp;
  }
  const aSeq = evidenceSequence(a);
  const bSeq = evidenceSequence(b);
  if (aSeq !== null && bSeq !== null && aSeq !== bSeq) {
    return aSeq - bSeq;
  }
  if (aSeq !== null && bSeq === null) {
    return 1;
  }
  if (aSeq === null && bSeq !== null) {
    return -1;
  }
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function isRoiGoPassForPlan(evidence, planId) {
  return (
    String(evidence?.source ?? "").trim() === "roi:go" &&
    String(evidence?.type ?? "").trim() === "verification" &&
    String(evidence?.result ?? "")
      .trim()
      .toLowerCase() === "pass" &&
    String(evidence?.content?.plan_id ?? "").trim() === planId
  );
}

function isQualityReviewReopenForPlan(evidence, planId) {
  if (
    String(evidence?.type ?? "").trim() !== "quality_review" ||
    String(evidence?.result ?? "")
      .trim()
      .toLowerCase() !== "reopen"
  ) {
    return false;
  }
  const planIds = Array.isArray(evidence?.content?.plan_ids) ? evidence.content.plan_ids : [];
  return planIds.some((id) => String(id).trim() === planId);
}

/** True when a post-ship quality_review reopen supersedes the latest roi:go pass. */
export function qualityReviewInvalidatesPlan(evidenceList, planId) {
  const pid = String(planId ?? "").trim();
  if (!pid) {
    return false;
  }
  const chronological = [...(evidenceList ?? [])].sort(compareEvidenceChronological);
  let invalidated = false;
  for (const ev of chronological) {
    if (isRoiGoPassForPlan(ev, pid)) {
      invalidated = false;
    }
    if (isQualityReviewReopenForPlan(ev, pid)) {
      invalidated = true;
    }
  }
  return invalidated;
}
