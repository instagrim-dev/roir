#!/usr/bin/env node
/**
 * Dogfood runner for the roi:go skill.
 *
 * Follows skills/roi-go/SKILL.md on a real or temp mission:
 *   1. Input dispatch (outline JSON → mission_id)
 *   2. status_get + plan_list
 *   3. Wave-ordered plans; optional --execute-verification runs oracles
 *   4. evidence_record per plan (source: roi:go)
 *
 * Usage:
 *   node scripts/dogfood-roi-go.mjs [--outline path] [--wave N] [--execute-verification]
 *       [--mission-id id] [--db path]
 *
 * Findings: scripts/dogfood-roi-go-findings.md
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");
const workspaceRoot = path.join(roiRoot, "..");
const serverPath = path.join(roiRoot, "src", "server.mjs");
const defaultOutline = path.join(
  roiRoot,
  "artifacts",
  "2026-05-26-mcp-server-serve-mcp-18-outline.json"
);

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const hasFlag = (name) => args.includes(name);

const outlinePath = flag("--outline") ?? defaultOutline;
const waveFilter = flag("--wave") ? Number(flag("--wave")) : undefined;
const executeVerification = hasFlag("--execute-verification");
const allowOracleOnly = hasFlag("--allow-oracle-only");
const missionIdArg = flag("--mission-id");
const dbPath =
  flag("--db") ?? path.join(roiRoot, ".data", "roi.sqlite");

const log = (msg) => console.log(msg);
const step = (msg) => console.log(`→ ${msg}`);

const findings = [];
function note(severity, tag, detail) {
  findings.push({ severity, tag, detail });
  console.log(`  [${severity}] ${tag}: ${detail}`);
}

function unwrap(result, toolName) {
  if (result.isError) {
    throw new Error(`${toolName} returned error: ${JSON.stringify(result.content)}`);
  }
  const text = result.content?.[0]?.text ?? result.content;
  try {
    return JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
  } catch {
    return text;
  }
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return unwrap(result, name);
}

function loadOutline(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const missionId =
    missionIdArg ??
    raw.mission_id ??
    raw.plan_generate?.plans?.[0]?.mission_id;
  const plans =
    raw.plan_generate?.plans ??
    raw.plans ??
    [];
  return { missionId, plans, source: file };
}

function sortPlans(plans) {
  return [...plans].sort((a, b) => {
    const wa = a.wave ?? 0;
    const wb = b.wave ?? 0;
    if (wa !== wb) return wa - wb;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

function oracleCwd(cmd) {
  if (cmd.includes("bmo/") || cmd.startsWith("cd bmo")) {
    return workspaceRoot;
  }
  return roiRoot;
}

function productTreeForPlan(plan) {
  const targets = (plan.verification_targets ?? []).join(" ");
  if (targets.includes("bmo/") || targets.startsWith("cd bmo")) {
    return path.join(workspaceRoot, "bmo");
  }
  return roiRoot;
}

function gitPorcelain(repoRoot) {
  try {
    return execSync("git status --porcelain", {
      cwd: repoRoot,
      encoding: "utf8"
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function planDiffSinceBaseline(repoRoot, baselineLines) {
  const before = new Set(baselineLines);
  const after = gitPorcelain(repoRoot);
  const delta = after.filter((line) => !before.has(line));
  return { delta, after };
}

/** Paths changed vs HEAD when porcelain baseline already includes WIP from earlier in the session. */
function gitDiffHeadPaths(repoRoot) {
  try {
    return execSync("git diff HEAD --name-only", {
      cwd: repoRoot,
      encoding: "utf8"
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function workspaceRelativePathsFromDelta(delta, repoRoot) {
  const treeKey = path.basename(repoRoot);
  return delta.map((line) => {
    const rel = String(line).slice(3).trim();
    if (rel.startsWith("bmo/") || rel.startsWith("roi/")) {
      return rel;
    }
    return `${treeKey}/${rel}`;
  });
}

function hasImplementationProof(plan, repoRoot, baselineLines) {
  const actions = plan.actions ?? [];
  if (actions.length === 0) {
    return { ok: true, reason: "verify-only plan (no actions)", delta: [], oracles_ok: true };
  }
  const { delta } = planDiffSinceBaseline(repoRoot, baselineLines);
  if (allowOracleOnly) {
    return {
      ok: false,
      reason: "oracle-only dry run (use result inconclusive, not pass)",
      delta,
      oracles_ok: false
    };
  }
  if (delta.length > 0) {
    return {
      ok: true,
      reason: `plan-scoped porcelain delta (${delta.length} entries)`,
      delta,
      oracles_ok: null
    };
  }
  const headPaths = gitDiffHeadPaths(repoRoot);
  if (headPaths.length > 0) {
    const treeKey = path.basename(repoRoot);
    const headDelta = headPaths.map((p) => ` M ${treeKey}/${p}`);
    return {
      ok: true,
      reason: `worktree diff vs HEAD (${headPaths.length} path(s))`,
      delta: headDelta,
      oracles_ok: null
    };
  }
  return {
    ok: false,
    reason: "implementation_proof_missing (no new changes since plan baseline)",
    delta,
    oracles_ok: false
  };
}

function runOracle(cmd, cwd) {
  try {
    const out = execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      timeout: 600_000
    });
    const tail = out.slice(-8000);
    if (cmd.includes("go test") && tail.includes("[no tests to run]")) {
      return { ok: false, output: `${tail}\n(no tests matched -run filter)` };
    }
    return { ok: true, output: tail };
  } catch (err) {
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    return {
      ok: false,
      output: (stdout + stderr).slice(-8000) || String(err.message)
    };
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  cwd: roiRoot,
  env: { ...process.env, ROI_SQLITE_PATH: dbPath }
});

const client = new Client({ name: "roi-go-dogfood", version: "0.0.1" });

try {
  await client.connect(transport);
  log("\n=== roi:go dogfood run ===\n");
  log(`Outline: ${outlinePath}`);
  log(`DB: ${dbPath}`);
  log(`Execute verification: ${executeVerification}\n`);

  if (!fs.existsSync(outlinePath)) {
    throw new Error(`outline not found: ${outlinePath}`);
  }

  const { missionId: outlineMissionId, plans: outlinePlans } = loadOutline(outlinePath);
  let missionId = outlineMissionId;
  if (!missionId) throw new Error("no mission_id in outline or --mission-id");

  log("── Step 1: Input dispatch (outline artifact) ──");
  note("PASS", "outline-load", `mission_id: ${missionId}, plans in artifact: ${outlinePlans.length}`);

  log("\n── Step 2: status_get ──");
  const status = await call(client, "status_get", { mission_id: missionId });
  const summary = status.summary ?? status;
  const runs = summary.runs ?? [];
  const activeRun = runs[runs.length - 1];
  const runId = activeRun?.id ?? "";
  note("PASS", "status_get", `runs: ${runs.length}, evidence_count: ${summary.evidence_count ?? "?"}`);
  if (runId) {
    note("INFO", "active-run", `${runId} status=${activeRun.status ?? "?"}`);
  }

  log("\n── Step 3: plan_list ──");
  const planList = await call(client, "plan_list", { mission_id: missionId });
  let plans = planList.plans ?? [];
  if (plans.length === 0 && outlinePlans.length > 0) {
    note("WARN", "plan_list-empty", "using plans from outline artifact only");
    plans = outlinePlans;
  }
  plans = sortPlans(plans);
  if (waveFilter != null) {
    plans = plans.filter((p) => (p.wave ?? 0) === waveFilter);
  }
  note("PASS", "plan_list", `${plans.length} plan(s) to process`);

  log("\n── Step 4: evidence_list (before) ──");
  const beforeEvidence = await call(client, "evidence_list", {
    mission_id: missionId,
    ...(runId ? { run_id: runId } : {})
  });
  const beforeCount = (beforeEvidence.evidence ?? []).length;
  note("INFO", "evidence-before", `${beforeCount} item(s)`);

  log("\n── Step 5: per-plan implementation evidence ──");
  const repoBaselines = new Map();
  for (const plan of plans) {
    const root = productTreeForPlan(plan);
    if (!repoBaselines.has(root)) {
      repoBaselines.set(root, gitPorcelain(root));
    }
  }
  const evidenceIds = [];
  for (const plan of plans) {
    const planId = plan.id;
    const title = plan.name ?? planId;
    const targets = plan.verification_targets ?? [];
    const oracleResults = [];

    if (executeVerification && targets.length > 0) {
      for (const cmd of targets) {
        const result = runOracle(cmd, oracleCwd(cmd));
        oracleResults.push({ cmd, ok: result.ok, output_tail: result.output });
        if (!result.ok) {
          note("FAIL", `oracle-${planId}`, `${cmd} failed`);
        }
      }
    } else if (targets.length > 0) {
      note("SKIP", `oracle-${planId}`, "re-run with --execute-verification to run targets");
    }

    const actions = plan.actions ?? [];
    const oraclesOk =
      targets.length === 0 ||
      (executeVerification && oracleResults.length > 0 && oracleResults.every((r) => r.ok));

    const repoRoot = productTreeForPlan(plan);
    const baseline = repoBaselines.get(repoRoot) ?? [];
    const proof = hasImplementationProof(plan, repoRoot, baseline);
    const proofOk = proof.ok && proof.oracles_ok !== false;
    const oraclesPass = oraclesOk && proof.oracles_ok !== false;
    let resultLabel = "fail";
    if (allowOracleOnly && executeVerification) {
      resultLabel = "inconclusive";
    } else if (oraclesPass && proofOk) {
      resultLabel = "pass";
    }

    if (!proofOk) {
      note("FAIL", `proof-${planId}`, proof.reason);
    }

    const verifyOnly = actions.length === 0 && targets.length > 0;
    const recorded = await call(client, "evidence_record", {
      mission_id: missionId,
      ...(runId ? { run_id: runId } : {}),
      ...(executeVerification && resultLabel === "pass" ? { run_oracles: true } : {}),
      type: "verification",
      source: "roi:go",
      result: resultLabel,
      content: {
        plan_id: planId,
        plan_revision: plan.revision,
        ...(verifyOnly ? { verify_only_plan: true } : {}),
        wave: plan.wave,
        plan_title: title,
        summary:
          resultLabel === "pass"
            ? "oracles and implementation proof ok"
            : proof.reason,
        implementation_proof: {
          diff_stat: proof.delta.join("\n").slice(0, 4000),
          paths_touched: workspaceRelativePathsFromDelta(proof.delta, repoRoot),
          oracles_run: executeVerification ? oracleResults : targets,
          oracles_ok: resultLabel === "pass",
          proof_reason: proof.reason
        },
        dogfood: true
      }
    });
    if (resultLabel === "pass") {
      repoBaselines.set(repoRoot, gitPorcelain(repoRoot));
    }
    const eid = recorded.evidence?.id ?? recorded.id ?? "?";
    evidenceIds.push(eid);
    step(`implemented ${title} (wave ${plan.wave ?? "?"}, evidence ${eid})`);
    note(
      resultLabel === "pass" ? "PASS" : "FAIL",
      `plan-${planId}`,
      `result=${resultLabel}`
    );
  }

  log("\n── Step 6: evidence_list (after) ──");
  const afterEvidence = await call(client, "evidence_list", {
    mission_id: missionId,
    ...(runId ? { run_id: runId } : {})
  });
  const roiGoCount = (afterEvidence.evidence ?? []).filter(
    (e) => e.source === "roi:go"
  ).length;
  note("PASS", "evidence-after", `total=${(afterEvidence.evidence ?? []).length}, roi:go source=${roiGoCount}`);

  log("\n=== roi:go final summary ===");
  log(`Mission ID:     ${missionId}`);
  log(`Plans processed: ${plans.length}`);
  log(`Evidence recorded: ${evidenceIds.join(", ")}`);
  log(`Next action:      roi:drive (verify gate + publish when oracles pass)`);
} finally {
  try {
    await client.close();
  } catch {
    /* ignore */
  }
}

const findingsPath = path.join(__dirname, "dogfood-roi-go-findings.md");
const md = [
  "# roi:go Dogfood Findings",
  "",
  `Date: ${new Date().toISOString().slice(0, 10)}`,
  `Outline: ${outlinePath}`,
  `DB: ${dbPath}`,
  `Execute verification: ${executeVerification}`,
  "",
  "## Tool call trace",
  "",
  "outline load → status_get → plan_list → evidence_list → evidence_record (×N) → evidence_list",
  "",
  "## Findings",
  "",
  ...findings.map((f) => `- **[${f.severity}]** \`${f.tag}\`: ${f.detail}`),
  "",
  "## Skill observations",
  "",
  "- `roi:go` correctly does not call `run_create`; evidence attaches to paused run when present.",
  "- Oracle cwd must be workspace root for `bmo/...` paths (fixed in runner).",
  "- `go test -run` with zero matches exits 0; runner treats `[no tests to run]` as fail.",
  "- D1: `evidence_record(pass)` requires oracles OK + non-empty product-tree diff when plan has actions (`--allow-oracle-only` overrides for dry runs).",
  "- Decision doc: `docs/meta-design/2026-05-27-roi-implementation-proof-and-executors.md`.",
  ""
].join("\n");

fs.writeFileSync(findingsPath, md);
console.log(`\nFindings written to ${findingsPath}`);
