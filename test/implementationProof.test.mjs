import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateRoiGoVerificationPass,
  oracleRunRecordPresent,
  validatePathsTouchedOnDisk,
  defaultRoiWorkspaceRoot,
  inferProductTreeKey,
  pathAppearsInPorcelain,
  runPlansHaveMcpVerifiedGoEvidence,
  runPlansHaveMcpVerifiedGoEvidenceForSubstantive,
  partialVerificationCheckpoint,
  partialVerificationEligible,
  verifyGateNextActions,
  isLocalImplementStubOutput,
  isSubstantiveRoiGoVerification,
  missionNeedsRoiGo,
  missionGoProgress,
  implementationProofTrust,
  missionImplementationProofTrust,
  IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED,
  substantiveRoiGoForPlan,
  filterReviewBlockingIssues,
  selectGoHandoffTarget,
  planDependenciesMet,
  pausedRunNextActions
} from "../src/implementationProof.mjs";

test("validateRoiGoVerificationPass rejects pass without proof", () => {
  assert.throws(
    () =>
      validateRoiGoVerificationPass({
        source: "roi:go",
        type: "verification",
        result: "pass",
        content: { implementation_proof: { oracles_ok: false } }
      }),
    /oracles_ok/
  );
});

test("validateRoiGoVerificationPass accepts pass with diff and oracles_ok", () => {
  assert.doesNotThrow(() =>
    validateRoiGoVerificationPass({
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        implementation_proof: {
          oracles_ok: true,
          diff_stat: "bmo/internal/mcp/server/foo.go | 10 +++++",
          paths_touched: ["bmo/internal/mcp/server/foo.go"]
        }
      }
    })
  );
});

test("validateRoiGoVerificationPass requires oracles_run when plan has verification_targets", () => {
  assert.throws(
    () =>
      validateRoiGoVerificationPass(
        {
          source: "roi:go",
          type: "verification",
          result: "pass",
          content: {
            plan_id: "plan_a",
            implementation_proof: {
              oracles_ok: true,
              diff_stat: "x",
              oracles_run: []
            }
          }
        },
        {
          plan: {
            id: "plan_a",
            actions: ["implement"],
            verification_targets: ["go test ./..."]
          }
        }
      ),
    /oracles_run/
  );
  assert.equal(
    oracleRunRecordPresent(
      { oracles_run: [{ cmd: "go test ./...", ok: true }] },
      { verification_targets: ["go test ./..."] }
    ),
    true
  );
});

test("validatePathsTouchedOnDisk rejects missing paths under workspace root", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-paths-"));
  try {
    const roiDir = path.join(dir, "roi");
    fs.mkdirSync(roiDir, { recursive: true });
    const existing = path.join(roiDir, "exists.txt");
    fs.writeFileSync(existing, "ok");
    assert.throws(
      () =>
        validatePathsTouchedOnDisk(
          { paths_touched: ["roi/missing.txt"] },
          { workspaceRoot: dir, plan: { actions: [], verification_targets: [] } }
        ),
      /not found on disk/
    );
    assert.doesNotThrow(() =>
      validatePathsTouchedOnDisk(
        { paths_touched: ["roi/exists.txt"] },
        { workspaceRoot: dir, plan: { actions: [], verification_targets: [] } }
      )
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("validatePathsTouchedOnDisk requires product-tree prefix", () => {
  const workspaceRoot = defaultRoiWorkspaceRoot();
  assert.throws(
    () =>
      validatePathsTouchedOnDisk(
        { paths_touched: ["internal/foo.go"] },
        { workspaceRoot, plan: { actions: ["x"], verification_targets: ["go test ./..."] } }
      ),
    /bmo\/ or roi\//
  );
  assert.equal(inferProductTreeKey({ verification_targets: ["cd bmo && go test"] }), "bmo");
});

test("validatePathsTouchedOnDisk rejects `..` traversal behind a valid prefix", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-paths-esc-"));
  try {
    // Create a real file OUTSIDE the workspace root that the escape would reach,
    // so the existence oracle would otherwise succeed and leak the escape.
    const outside = path.join(dir, "secret.txt");
    fs.writeFileSync(outside, "top secret");
    const root = path.join(dir, "workspace");
    fs.mkdirSync(path.join(root, "roi"), { recursive: true });
    assert.throws(
      () =>
        validatePathsTouchedOnDisk(
          { paths_touched: ["roi/../../secret.txt"] },
          { workspaceRoot: root, plan: { actions: [], verification_targets: [] } }
        ),
      /escapes the workspace root/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pathAppearsInPorcelain matches porcelain lines", () => {
  const lines = [" M bmo/go.mod", "?? roi/foo.mjs"];
  assert.equal(pathAppearsInPorcelain("bmo/go.mod", lines), true);
  assert.equal(pathAppearsInPorcelain("bmo/other.go", lines), false);
});

test("runPlansHaveMcpVerifiedGoEvidence requires mcp verified substantive go", () => {
  const plans = [{ id: "p1", actions: ["a"], verification_targets: ["t"] }];
  const agentOnly = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        plan_id: "p1",
        implementation_proof: { oracles_ok: true, diff_stat: "x", paths_touched: ["roi/x"] }
      }
    }
  ];
  assert.equal(runPlansHaveMcpVerifiedGoEvidence(plans, agentOnly, ["p1"]), false);
  const mcpVerified = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        plan_id: "p1",
        implementation_proof: {
          verified_by: "mcp",
          oracles_ok: true,
          diff_stat: "x",
          paths_touched: ["roi/x"]
        }
      }
    }
  ];
  assert.equal(runPlansHaveMcpVerifiedGoEvidence(plans, mcpVerified, ["p1"]), true);
});

test("verifyGateNextActions surfaces roi:go on non-pass", () => {
  assert.deepEqual(verifyGateNextActions("partial", "U2 hub smoke missing"), [
    "roi:go",
    "roi:edit",
    "roi:inspect"
  ]);
});

test("verifyGateNextActions partial checkpoint pass withholds publish", () => {
  assert.deepEqual(verifyGateNextActions("pass", { partialCheckpoint: true }), [
    "roi:go",
    "roi:inspect"
  ]);
  assert.deepEqual(verifyGateNextActions("pass"), ["roi:publish", "roi:learn"]);
});

test("partialVerificationCheckpoint denies zero substantive", () => {
  const plans = [
    { id: "p1", actions: ["a"], verification_targets: ["t"] },
    { id: "p2", actions: ["b"], verification_targets: ["u"] }
  ];
  const checkpoint = partialVerificationCheckpoint(plans, [], ["p1", "p2"]);
  assert.equal(checkpoint.allowed, false);
  assert.equal(checkpoint.partial_checkpoint, false);
});

test("partialVerificationCheckpoint marks partial when one of three substantive", () => {
  const plans = [
    { id: "p1", actions: ["a"], verification_targets: ["t"] },
    { id: "p2", actions: ["b"], verification_targets: ["u"] },
    { id: "p3", actions: ["c"], verification_targets: ["v"] }
  ];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        plan_id: "p1",
        implementation_proof: {
          oracles_ok: true,
          diff_stat: "x",
          paths_touched: ["roi/x"]
        }
      }
    }
  ];
  const checkpoint = partialVerificationCheckpoint(plans, evidence, ["p1", "p2", "p3"]);
  assert.equal(checkpoint.allowed, true);
  assert.equal(checkpoint.partial_checkpoint, true);
  assert.equal(checkpoint.substantive_count, 1);
  assert.equal(checkpoint.open_count, 2);
});

test("partialVerificationCheckpoint not partial when all substantive", () => {
  const plans = [
    { id: "p1", actions: ["a"], verification_targets: ["t"] },
    { id: "p2", actions: ["b"], verification_targets: ["u"] }
  ];
  const evidence = ["p1", "p2"].map((plan_id) => ({
    source: "roi:go",
    type: "verification",
    result: "pass",
    content: {
      plan_id,
      implementation_proof: {
        oracles_ok: true,
        diff_stat: "x",
        paths_touched: ["roi/x"]
      }
    }
  }));
  const checkpoint = partialVerificationCheckpoint(plans, evidence, ["p1", "p2"]);
  assert.equal(checkpoint.allowed, true);
  assert.equal(checkpoint.partial_checkpoint, false);
});

test("runPlansHaveMcpVerifiedGoEvidenceForSubstantive ignores open plans", () => {
  const plans = [
    { id: "p1", actions: ["a"], verification_targets: ["t"] },
    { id: "p2", actions: ["b"], verification_targets: ["u"] }
  ];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        plan_id: "p1",
        implementation_proof: {
          verified_by: "mcp",
          oracles_ok: true,
          diff_stat: "x",
          paths_touched: ["roi/x"]
        }
      }
    }
  ];
  assert.equal(runPlansHaveMcpVerifiedGoEvidence(plans, evidence, ["p1", "p2"]), false);
  assert.equal(runPlansHaveMcpVerifiedGoEvidenceForSubstantive(plans, evidence, ["p1", "p2"]), true);
});

test("partialVerificationEligible mirrors mission progress", () => {
  const plans = [{ id: "p1", actions: ["a"], verification_targets: ["t"] }];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        plan_id: "p1",
        implementation_proof: { oracles_ok: true, diff_stat: "x", paths_touched: ["roi/x"] }
      }
    }
  ];
  assert.equal(partialVerificationEligible(plans, evidence).eligible, false);
  const open = partialVerificationEligible(plans, []).eligible;
  assert.equal(open, false);
  const partial = partialVerificationEligible(
    [...plans, { id: "p2", actions: ["b"], verification_targets: ["u"] }],
    evidence
  );
  assert.equal(partial.eligible, true);
  assert.equal(partial.open_count, 1);
});

test("isLocalImplementStubOutput detects stub marker", () => {
  assert.equal(isLocalImplementStubOutput("LOCAL_EXECUTION_COMPLETED\nprompt"), true);
  assert.equal(isLocalImplementStubOutput("real output"), false);
});

test("missionNeedsRoiGo when latest verification is fail or lacks proof", () => {
  const plans = [{ id: "plan_a", actions: ["implement"], verification_targets: ["test"] }];
  assert.equal(
    missionNeedsRoiGo(plans, [
      {
        source: "roi:go",
        type: "verification",
        result: "fail",
        created_at: "2026-05-27T02:00:00.000Z",
        content: { plan_id: "plan_a" }
      }
    ]),
    true
  );
  assert.equal(
    isSubstantiveRoiGoVerification({
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        implementation_proof: { oracles_ok: true, diff_stat: "foo.go | 1 +" }
      }
    }),
    true
  );
  assert.equal(
    missionNeedsRoiGo(plans, [
      {
        source: "roi:go",
        type: "verification",
        result: "pass",
        created_at: "2026-05-27T02:00:00.000Z",
        content: {
          plan_id: "plan_a",
          implementation_proof: { oracles_ok: true, diff_stat: "foo.go | 1 +" }
        }
      }
    ]),
    false
  );
});

test("missionNeedsRoiGo skips delivered convergence plan ids", () => {
  const plans = [
    { id: "plan_done", actions: ["x"], verification_targets: ["t"] },
    { id: "plan_open", actions: ["y"], verification_targets: ["u"] }
  ];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "fail",
      created_at: "2026-05-27T02:00:00.000Z",
      content: { plan_id: "plan_done" }
    },
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      created_at: "2026-05-27T03:00:00.000Z",
      content: {
        plan_id: "plan_open",
        implementation_proof: { oracles_ok: true, diff_stat: "open | 1 +" }
      }
    }
  ];
  assert.equal(missionNeedsRoiGo(plans, evidence), true);
  assert.equal(missionNeedsRoiGo(plans, evidence, { skipPlanIds: ["plan_done"] }), false);
});

test("pausedRunNextActions leads with roi:go when work is owed", () => {
  assert.deepEqual(pausedRunNextActions({ needsGo: true }), [
    "roi:go",
    "roi:edit",
    "roi:inspect"
  ]);
});

test("selectGoHandoffTarget picks lowest wave plan needing go", () => {
  const plans = [
    { id: "plan_w2", wave: 2, name: "U2", actions: ["a"], verification_targets: ["t"] },
    { id: "plan_w1", wave: 1, name: "U1", actions: ["b"], verification_targets: ["u"] }
  ];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      created_at: "2026-05-27T04:00:00.000Z",
      content: {
        plan_id: "plan_w1",
        implementation_proof: { oracles_ok: true, diff_stat: "u1 | 1 +" }
      }
    }
  ];
  const target = selectGoHandoffTarget(plans, evidence);
  assert.equal(target?.plan_id, "plan_w2");
  assert.equal(target?.wave, 2);
  assert.equal(target?.reason, "no_roi_go_verification");
});

test("missionGoProgress tracks open plans and completion", () => {
  const plans = [
    { id: "p1", wave: 1, actions: ["a"], verification_targets: ["t"] },
    { id: "p2", wave: 2, actions: ["b"], verification_targets: ["u"] }
  ];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      created_at: "2026-05-27T05:00:00.000Z",
      content: {
        plan_id: "p1",
        implementation_proof: { oracles_ok: true, diff_stat: "p1 | 1 +" }
      }
    }
  ];
  const progress = missionGoProgress(plans, evidence);
  assert.equal(progress.total, 2);
  assert.equal(progress.substantive, 1);
  assert.equal(progress.complete, false);
  assert.equal(progress.open[0].plan_id, "p2");
});

test("substantiveRoiGoForPlan and filterReviewBlockingIssues bridge stub reviews", () => {
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      created_at: "2026-05-27T06:00:00.000Z",
      content: {
        plan_id: "plan_a",
        implementation_proof: { oracles_ok: true, paths_touched: ["bmo/foo.go"] }
      }
    }
  ];
  assert.equal(substantiveRoiGoForPlan(evidence, "plan_a"), true);
  const issues = [
    "local_implement_stub_only",
    "missing_verification_targets"
  ];
  assert.deepEqual(filterReviewBlockingIssues(issues, { roiGoSatisfied: true }), [
    "missing_verification_targets"
  ]);
});

test("implementationProofTrust distinguishes agent_claimed and mcp_verified", () => {
  assert.equal(implementationProofTrust(null), "agent_claimed");
  assert.equal(
    implementationProofTrust({
      source: "roi:go",
      type: "verification",
      result: "pass",
      content: {
        implementation_proof: { verified_by: "mcp", oracles_ok: true, diff_stat: "x" }
      }
    }),
    IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED
  );
  const plans = [{ id: "p1", actions: ["a"], verification_targets: ["t"] }];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      created_at: "2026-05-27T10:00:00.000Z",
      content: {
        plan_id: "p1",
        plan_revision: 1,
        implementation_proof: {
          verified_by: "mcp",
          oracles_ok: true,
          diff_stat: "foo | 1 +"
        }
      }
    }
  ];
  assert.equal(missionImplementationProofTrust(plans, evidence), IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED);
});

test("validateRoiGoVerificationPass rejects verify_only_plan when plan has actions", () => {
  assert.throws(
    () =>
      validateRoiGoVerificationPass(
        {
          source: "roi:go",
          type: "verification",
          result: "pass",
          content: {
            plan_id: "plan_a",
            verify_only_plan: true,
            implementation_proof: { oracles_ok: true }
          }
        },
        { plan: { id: "plan_a", revision: 2, actions: ["implement"], verification_targets: ["t"] } }
      ),
    /verify_only_plan/
  );
});

test("isSubstantiveRoiGoVerification rejects stale plan_revision", () => {
  const plan = { id: "plan_a", revision: 3, actions: ["x"], verification_targets: ["t"] };
  const evidence = {
    source: "roi:go",
    type: "verification",
    result: "pass",
    content: {
      plan_id: "plan_a",
      plan_revision: 2,
      implementation_proof: { oracles_ok: true, diff_stat: "foo | 1 +" }
    }
  };
  assert.equal(isSubstantiveRoiGoVerification(evidence, plan), false);
});

test("missionGoProgress complete when no in-scope plans", () => {
  const progress = missionGoProgress([{ id: "p0", actions: [], verification_targets: [] }], []);
  assert.equal(progress.total, 0);
  assert.equal(progress.complete, true);
});

test("selectGoHandoffTarget respects plan dependencies", () => {
  const plans = [
    { id: "plan_w1", wave: 1, name: "U1", actions: ["a"], verification_targets: ["t"], dependencies: [] },
    { id: "plan_w2", wave: 2, name: "U2", actions: ["b"], verification_targets: ["u"], dependencies: ["plan_w1"] }
  ];
  const evidence = [];
  const target = selectGoHandoffTarget(plans, evidence);
  assert.equal(target?.plan_id, "plan_w1");
  assert.equal(planDependenciesMet(plans[1], plans, evidence), false);
});

test("selectGoHandoffTarget returns null when all plans substantively pass", () => {
  const plans = [{ id: "p1", wave: 1, actions: ["x"], verification_targets: ["t"] }];
  const evidence = [
    {
      source: "roi:go",
      type: "verification",
      result: "pass",
      created_at: "2026-05-27T05:00:00.000Z",
      content: {
        plan_id: "p1",
        implementation_proof: { oracles_ok: true, paths_touched: ["bmo/foo.go"] }
      }
    }
  ];
  assert.equal(selectGoHandoffTarget(plans, evidence), null);
});
