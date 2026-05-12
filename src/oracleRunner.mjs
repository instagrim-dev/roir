/**
 * Execute plan verification_targets in the product workspace (D7-w1).
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { defaultRoiWorkspaceRoot } from "./implementationProof.mjs";

export const VACUOUS_GO_TEST_MARKER = "[no tests to run]";

export function roiPackageRoot(workspaceRoot = defaultRoiWorkspaceRoot()) {
  return path.join(workspaceRoot, "roi");
}

export function oracleCwdForCommand(cmd, workspaceRoot = defaultRoiWorkspaceRoot()) {
  const trimmed = String(cmd).trim();
  if (trimmed.includes("bmo/") || trimmed.startsWith("cd bmo")) {
    return workspaceRoot;
  }
  return roiPackageRoot(workspaceRoot);
}

export function runOracleCommand(cmd, { cwd, timeoutMs = 600_000 } = {}) {
  const command = String(cmd).trim();
  if (!command) {
    return { ok: false, cmd: command, exitCode: 1, output: "empty verification_target" };
  }
  try {
    const out = execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      timeout: timeoutMs
    });
    const tail = out.slice(-8000);
    if (command.includes("go test") && tail.includes(VACUOUS_GO_TEST_MARKER)) {
      return {
        ok: false,
        cmd: command,
        exitCode: 1,
        output: `${tail}\n(vacuous go test: ${VACUOUS_GO_TEST_MARKER})`
      };
    }
    return { ok: true, cmd: command, exitCode: 0, output: tail };
  } catch (err) {
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    const output = (stdout + stderr).slice(-8000) || String(err.message ?? err);
    const exitCode = typeof err.status === "number" ? err.status : 1;
    if (command.includes("go test") && output.includes(VACUOUS_GO_TEST_MARKER)) {
      return {
        ok: false,
        cmd: command,
        exitCode,
        output: `${output}\n(vacuous go test: ${VACUOUS_GO_TEST_MARKER})`
      };
    }
    return { ok: false, cmd: command, exitCode, output };
  }
}

export function runPlanVerificationTargets(plan, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? defaultRoiWorkspaceRoot();
  const targets = Array.isArray(plan?.verification_targets) ? plan.verification_targets : [];
  const oracles_run = [];
  for (const target of targets) {
    const cmd = String(target).trim();
    if (!cmd) {
      continue;
    }
    const cwd = oracleCwdForCommand(cmd, workspaceRoot);
    const result = runOracleCommand(cmd, { cwd, timeoutMs: options.timeoutMs });
    oracles_run.push({
      cmd: result.cmd,
      ok: result.ok,
      exit_code: result.exitCode,
      output: result.output
    });
  }
  const oracles_ok =
    targets.filter((t) => String(t).trim()).length === 0
      ? true
      : oracles_run.length > 0 && oracles_run.every((row) => row.ok === true);
  return { oracles_run, oracles_ok };
}

/** Mutates `content.implementation_proof` with MCP oracle results (D7-w1). */
export function applyMcpOracleVerification(content, plan, options = {}) {
  const { oracles_run, oracles_ok } = runPlanVerificationTargets(plan, options);
  const prior =
    content.implementation_proof && typeof content.implementation_proof === "object"
      ? content.implementation_proof
      : {};
  content.implementation_proof = {
    ...prior,
    oracles_run,
    oracles_ok,
    verified_by: "mcp"
  };
  return { oracles_run, oracles_ok };
}

/** Mutates `content.verify_gate` with MCP oracle results for verify.evaluate (D2-D). */
export function applyVerifyGateOracleVerification(content, plans, options = {}) {
  const planList = Array.isArray(plans) ? plans : [];
  const by_plan = {};
  const oracles_run = [];
  let oracles_ok = true;
  for (const plan of planList) {
    const result = runPlanVerificationTargets(plan, options);
    by_plan[plan.id] = {
      plan_revision: plan.revision,
      oracles_run: result.oracles_run,
      oracles_ok: result.oracles_ok
    };
    for (const row of result.oracles_run) {
      oracles_run.push({ ...row, plan_id: plan.id });
    }
    if (!result.oracles_ok) {
      oracles_ok = false;
    }
  }
  if (planList.length === 0) {
    oracles_ok = true;
  }
  content.verify_gate = {
    by_plan,
    oracles_run,
    oracles_ok,
    verified_by: "mcp"
  };
  return { oracles_run, oracles_ok, by_plan };
}
