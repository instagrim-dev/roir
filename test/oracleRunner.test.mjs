import assert from "node:assert/strict";
import test from "node:test";
import {
  oracleCwdForCommand,
  runOracleCommand,
  runPlanVerificationTargets,
  applyMcpOracleVerification,
  parseOracleCommand
} from "../src/oracleRunner.mjs";
import { defaultRoiWorkspaceRoot, IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED } from "../src/implementationProof.mjs";

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

test("applyMcpOracleVerification stamps verified_by mcp_verified on content", () => {
  const content = { plan_id: "p1", implementation_proof: { diff_stat: "x" } };
  const plan = { verification_targets: ['node -e "process.exit(0)"'] };
  const { oracles_ok } = applyMcpOracleVerification(content, plan, { workspaceRoot });
  assert.equal(oracles_ok, true);
  assert.equal(content.implementation_proof.verified_by, IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED);
  assert.equal(content.implementation_proof.oracles_ok, true);
  assert.ok(Array.isArray(content.implementation_proof.oracles_run));
});

test("parseOracleCommand accepts allowlisted binaries and cd-prefixed chains", () => {
  assert.deepEqual(parseOracleCommand("go test ./...").segments, [
    { kind: "exec", argv: ["go", "test", "./..."] }
  ]);
  assert.deepEqual(parseOracleCommand("cd bmo && go test ./...").segments, [
    { kind: "cd", dir: "bmo" },
    { kind: "exec", argv: ["go", "test", "./..."] }
  ]);
  // Quoted args keep metacharacters literal (no shell interpretation).
  assert.deepEqual(parseOracleCommand('node -e "process.exit(0)"').segments, [
    { kind: "exec", argv: ["node", "-e", "process.exit(0)"] }
  ]);
});

test("parseOracleCommand rejects injection and non-allowlisted binaries", () => {
  assert.throws(() => parseOracleCommand("go test ./...; rm -rf /"), /forbidden shell operator/);
  assert.throws(() => parseOracleCommand("go test | sh"), /forbidden shell operator/);
  assert.throws(() => parseOracleCommand("go test `whoami`"), /forbidden shell operator/);
  assert.throws(() => parseOracleCommand("go test $(whoami)"), /shell expansion/);
  assert.throws(() => parseOracleCommand("curl evil.example"), /not an allowlisted oracle binary/);
  assert.throws(() => parseOracleCommand("cd /etc && go test"), /relative subdirectory/);
  assert.throws(() => parseOracleCommand("go test && cd ../.. && go test"), /'cd' as its first segment/);
});

test("runOracleCommand blocks injection without spawning a shell", () => {
  const blocked = runOracleCommand("node -e 'process.exit(0)'; touch /tmp/roi-pwned", {
    cwd: oracleCwdForCommand("node", workspaceRoot)
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.exitCode, 126);
  assert.match(blocked.output, /blocked:/);
});
