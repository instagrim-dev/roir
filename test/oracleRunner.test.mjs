import assert from "node:assert/strict";
import test from "node:test";
import {
  oracleCwdForCommand,
  runOracleCommand,
  runPlanVerificationTargets,
  applyMcpOracleVerification
} from "../src/oracleRunner.mjs";
import { defaultRoiWorkspaceRoot } from "../src/implementationProof.mjs";

const workspaceRoot = defaultRoiWorkspaceRoot();

test("oracleCwdForCommand uses workspace root for bmo targets", () => {
  assert.equal(oracleCwdForCommand("cd bmo && go test ./...", workspaceRoot), workspaceRoot);
  assert.notEqual(oracleCwdForCommand("node -e '0'", workspaceRoot), workspaceRoot);
});

test("runOracleCommand records pass and fail exit codes", () => {
  const pass = runOracleCommand('node -e "process.exit(0)"', {
    cwd: oracleCwdForCommand("node", workspaceRoot)
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.exitCode, 0);

  const fail = runOracleCommand('node -e "process.exit(2)"', {
    cwd: oracleCwdForCommand("node", workspaceRoot)
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.exitCode, 2);
});

test("runPlanVerificationTargets aggregates oracles_ok", () => {
  const plan = {
    verification_targets: ['node -e "process.exit(0)"', 'node -e "process.exit(0)"']
  };
  const { oracles_run, oracles_ok } = runPlanVerificationTargets(plan, { workspaceRoot });
  assert.equal(oracles_run.length, 2);
  assert.equal(oracles_ok, true);
});

test("applyMcpOracleVerification stamps verified_by mcp on content", () => {
  const content = { plan_id: "p1", implementation_proof: { diff_stat: "x" } };
  const plan = { verification_targets: ['node -e "process.exit(0)"'] };
  const { oracles_ok } = applyMcpOracleVerification(content, plan, { workspaceRoot });
  assert.equal(oracles_ok, true);
  assert.equal(content.implementation_proof.verified_by, "mcp");
  assert.equal(content.implementation_proof.oracles_ok, true);
  assert.ok(Array.isArray(content.implementation_proof.oracles_run));
});
