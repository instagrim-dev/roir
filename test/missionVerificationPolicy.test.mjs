import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MISSION_VERIFY_POLICY_DEFAULT,
  MISSION_VERIFY_POLICY_STRICT,
  missionRequiresHelperVerifiedProof,
  missionVerificationPolicyFromBrief,
  qualityReviewInvalidatesPlan,
  validatePerPlanProofDistinctness,
  validateStrictMissionGoEvidence
} from "../src/missionVerificationPolicy.mjs";

test("missionVerificationPolicyFromBrief honors explicit and graduation hints", () => {
  assert.equal(
    missionVerificationPolicyFromBrief({
      constraints: ["verification_policy: strict"]
    }),
    MISSION_VERIFY_POLICY_STRICT
  );
  assert.equal(
    missionVerificationPolicyFromBrief({
      constraints: ["graduation_mode: A-grade-domain-graduation"]
    }),
    MISSION_VERIFY_POLICY_STRICT
  );
  assert.equal(
    missionVerificationPolicyFromBrief({
      constraints: ["verification_policy: default", "graduation_mode: x"]
    }),
    MISSION_VERIFY_POLICY_DEFAULT
  );
  assert.equal(missionVerificationPolicyFromBrief({ constraints: [] }), MISSION_VERIFY_POLICY_DEFAULT);
});

test("validateStrictMissionGoEvidence blocks agent-claimed pass", () => {
  const brief = { constraints: ["verification_policy: strict"] };
  assert.throws(
    () =>
      validateStrictMissionGoEvidence(
        {
          source: "roi:go",
          type: "verification",
          result: "pass",
          run_oracles: false
        },
        brief
      ),
    /run_oracles: true/
  );
  assert.doesNotThrow(() =>
    validateStrictMissionGoEvidence(
      {
        source: "roi:go",
        type: "verification",
        result: "pass",
        run_oracles: true
      },
      brief
    )
  );
});

test("validatePerPlanProofDistinctness rejects duplicate bundles", () => {
  const planA = "plan_a";
  const planB = "plan_b";
  const bundle = {
    diff_stat: "14 files, +316/-27",
    paths_touched: ["bmo/internal/mcp/server/server.go"],
    oracles_ok: true
  };
  const evidenceList = [
    {
      source: "roi:go",
      type: "verification",
      content: { plan_id: planA, implementation_proof: bundle }
    }
  ];
  assert.throws(
    () =>
      validatePerPlanProofDistinctness({
        content: { plan_id: planB, implementation_proof: { ...bundle } },
        evidenceList,
        planId: planB
      }),
    /duplicate implementation_proof/
  );
  assert.doesNotThrow(() =>
    validatePerPlanProofDistinctness({
      content: {
        plan_id: planB,
        implementation_proof: { ...bundle, shared_bundle: true }
      },
      evidenceList,
      planId: planB
    })
  );
});

test("qualityReviewInvalidatesPlan supersedes stale roi:go pass", () => {
  const planId = "plan_x";
  const evidenceList = [
    {
      captured_at: "2026-06-24T10:00:00Z",
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        plan_id: planId,
        implementation_proof: { oracles_ok: true, diff_stat: "a" }
      }
    },
    {
      captured_at: "2026-06-24T11:00:00Z",
      type: "quality_review",
      result: "reopen",
      content: { plan_ids: [planId], summary: "godoc + docs gap" }
    }
  ];
  assert.equal(qualityReviewInvalidatesPlan(evidenceList, planId), true);
  assert.equal(missionRequiresHelperVerifiedProof({ constraints: [] }), false);
});

test("qualityReviewInvalidatesPlan uses last-event-wins at same captured_at", () => {
  const planId = "plan_x";
  const ts = "2026-06-24T10:00:00.000Z";
  const goThenReopen = [
    {
      id: "evidence_01_go",
      captured_at: ts,
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: { plan_id: planId, implementation_proof: { oracles_ok: true, diff_stat: "a" } }
    },
    {
      id: "evidence_02_reopen",
      captured_at: ts,
      type: "quality_review",
      result: "reopen",
      content: { plan_ids: [planId], summary: "gap" }
    }
  ];
  assert.equal(qualityReviewInvalidatesPlan(goThenReopen, planId), true);

  const reopenThenGo = [
    {
      id: "evidence_01_reopen",
      captured_at: ts,
      type: "quality_review",
      result: "reopen",
      content: { plan_ids: [planId], summary: "gap" }
    },
    {
      id: "evidence_02_go",
      captured_at: ts,
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: { plan_id: planId, implementation_proof: { oracles_ok: true, diff_stat: "a" } }
    }
  ];
  assert.equal(qualityReviewInvalidatesPlan(reopenThenGo, planId), false);
});
