#!/usr/bin/env node
/**
 * Dogfood runner for the roi:drive skill (compound actuation v0.1.2).
 *
 * Default path (MCP #18 mission):
 *   1. status_get — if next_actions leads with roi:go, chain roi:go (dogfood-roi-go.mjs)
 *   2. Re-enter status_get and continue lifecycle (verify_gate, publish when evidence allows)
 *
 * Legacy path (--legacy-fresh): ephemeral DB + article mission (lifecycle-only smoke).
 *
 * Usage:
 *   node scripts/dogfood-roi-drive.mjs
 *   node scripts/dogfood-roi-drive.mjs --mission-id mission_... --db roi/.data/roi.sqlite
 *   node scripts/dogfood-roi-drive.mjs --drive-only
 *   node scripts/dogfood-roi-drive.mjs --strict
 *   node scripts/dogfood-roi-drive.mjs --legacy-fresh
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");
const serverPath = path.join(roiRoot, "src", "server.mjs");
const goScript = path.join(__dirname, "dogfood-roi-go.mjs");
const defaultMissionId = "mission_75b9925a-dd02-4d2b-8baa-0bf5f4ea25d5";
const defaultDb = path.join(roiRoot, ".data", "roi.sqlite");

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const hasFlag = (name) => args.includes(name);

const legacyFresh = hasFlag("--legacy-fresh");
const driveOnly = hasFlag("--drive-only");
const strictVerify =
  hasFlag("--strict") || process.env.ROI_STRICT_VERIFY === "1";
const missionIdArg = flag("--mission-id");
const dbPathArg = flag("--db");
const waveFilter = flag("--wave");
const skipGoExec = hasFlag("--skip-go-exec");

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

async function call(client, name, callArgs) {
  const result = await client.callTool({ name, arguments: callArgs });
  return unwrap(result, name);
}

function latestRoiGoByPlan(evidence) {
  const byPlan = new Map();
  for (const row of evidence ?? []) {
    if (row.source !== "roi:go" || row.type !== "verification") continue;
    const planId = row.content?.plan_id ?? "";
    const created = row.created_at ?? "";
    const prev = byPlan.get(planId);
    if (!prev || String(created) > String(prev.created_at ?? "")) {
      byPlan.set(planId, row);
    }
  }
  return byPlan;
}

function isSubstantiveGoPass(row) {
  if (!row || String(row.result ?? "").toLowerCase() !== "pass") return false;
  const proof = row.content?.implementation_proof ?? {};
  if (!proof.oracles_ok) return false;
  const diff = String(proof.diff_stat ?? "").trim();
  const paths = Array.isArray(proof.paths_touched)
    ? proof.paths_touched.filter((p) => String(p).trim())
    : [];
  return Boolean(diff || paths.length);
}

function isMcpVerifiedGoPass(row) {
  if (!isSubstantiveGoPass(row)) return false;
  const proof = row.content?.implementation_proof ?? {};
  return String(proof.verified_by ?? "").trim() === "mcp";
}

function runCompoundGo(missionId, dbPath) {
  const goArgs = [
    goScript,
    "--mission-id",
    missionId,
    "--db",
    dbPath,
    "--execute-verification"
  ];
  if (waveFilter != null) {
    goArgs.push("--wave", String(waveFilter));
  }
  const result = spawnSync(process.execPath, goArgs, {
    cwd: roiRoot,
    encoding: "utf8",
    env: { ...process.env, ROI_SQLITE_PATH: dbPath }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

async function compoundDriveDogfood(client, missionId, dbPath) {
  log("\n=== roi:drive compound dogfood (MCP #18 mission) ===\n");
  log(`Mission: ${missionId}`);
  log(`Drive only: ${driveOnly}`);
  log(`Strict verify: ${strictVerify}\n`);

  log("── Step 1: status_get (state-read) ──");
  let status = await call(client, "status_get", { mission_id: missionId });
  let summary = status.summary ?? status;
  let nextActions = summary.next_actions ?? [];
  note("PASS", "status_get-initial", `next_actions: ${nextActions.join(", ") || "(empty)"}`);

  const needsGoFirst = nextActions[0] === "roi:go";
  if (needsGoFirst && !driveOnly) {
    log("\n── Step 2: compound actuation → roi:go workflow ──");
    step("implementation stage (roi:go)");
    if (skipGoExec) {
      note("SKIP", "roi-go-exec", "use --skip-go-exec removed; run dogfood-roi-go manually");
    } else {
      const goOk = runCompoundGo(missionId, dbPath);
      if (goOk) {
        step("roi:go complete");
        note("PASS", "compound-go", "dogfood-roi-go.mjs exited 0");
      } else {
        step("roi:go blocked");
        note("FAIL", "compound-go", "dogfood-roi-go.mjs exited non-zero");
      }
    }

    log("\n── Step 3: re-enter roi:drive (status_get) ──");
    status = await call(client, "status_get", { mission_id: missionId });
    summary = status.summary ?? status;
    nextActions = summary.next_actions ?? [];
    note("INFO", "status_get-after-go", `next_actions: ${nextActions.join(", ") || "(empty)"}`);
  } else if (needsGoFirst && driveOnly) {
    note("PASS", "drive-only", "skipped roi:go workflow per operator constraint");
    log("\n=== roi:drive final summary ===");
    log(`Mission ID: ${missionId}`);
    log("Next action: roi:go (drive-only — implementation not run in this invocation)");
    return;
  } else {
    note("INFO", "compound-go-skip", "roi:go not first in next_actions");
  }

  const runs = summary.runs ?? [];
  const lastRun = runs[runs.length - 1];
  const runId = lastRun?.id;
  const runStatus = lastRun?.status ?? "none";

  log("\n── Step 4: evidence_list + verify gate posture ──");
  const evidenceList = await call(client, "evidence_list", {
    mission_id: missionId,
    ...(runId ? { run_id: runId } : {})
  });
  const evidence = evidenceList.evidence ?? [];
  const byPlan = latestRoiGoByPlan(evidence);
  let substantivePlans = 0;
  let mcpVerifiedPlans = 0;
  let openPlans = 0;
  for (const [, row] of byPlan) {
    openPlans++;
    if (isSubstantiveGoPass(row)) substantivePlans++;
    if (isMcpVerifiedGoPass(row)) mcpVerifiedPlans++;
  }
  note(
    "INFO",
    "roi-go-evidence",
    `plans with roi:go rows: ${openPlans}, substantive pass: ${substantivePlans}, mcp_verified: ${mcpVerifiedPlans}`
  );
  const proofTrust = summary.implementation_proof_trust ?? "agent_claimed";
  note("INFO", "implementation_proof_trust", proofTrust);
  if (strictVerify && proofTrust !== "mcp_verified") {
    note(
      "WARN",
      "strict-trust",
      "strict mode expects mcp_verified after go with run_oracles (dogfood-roi-go uses --execute-verification)"
    );
  }

  const goProgress = summary.mission_go_progress ?? {};
  const partialEligible = summary.partial_verification_eligible ?? {};
  const missionComplete = goProgress.complete === true;
  const canPartialCheckpoint =
    substantivePlans > 0 && !missionComplete && partialEligible.eligible !== false;

  note(
    "INFO",
    "mission-go-progress",
    `substantive: ${goProgress.substantive ?? "?"}/${goProgress.total ?? "?"}, complete: ${missionComplete}, partial_eligible: ${partialEligible.eligible ?? "?"}`
  );

  const stillNeedsGo = nextActions[0] === "roi:go";
  const atVerify = nextActions.includes("roi:review") || runStatus === "paused";

  if (stillNeedsGo && !canPartialCheckpoint) {
    note("FAIL", "verify-blocked", "implementation proof still owed — will not verify_evaluate(pass)");
    log("\n=== roi:drive final summary ===");
    log(`Mission ID: ${missionId}`);
    log(`Final state: run=${runStatus}, still owes roi:go`);
    log("Compound actuation: attempted go stage; verify/publish deferred");
    return;
  }

  if ((atVerify || (stillNeedsGo && canPartialCheckpoint)) && runId) {
    log("\n── Step 5: verify_evaluate (honest verdict) ──");
    let verdict = "fail";
    let notes = "Dogfood: no substantive roi:go verification — refusing pass.";
    const verifyPayload = { run_id: runId, notes: "" };

    if (missionComplete && substantivePlans > 0) {
      verdict = "pass";
      notes = "Dogfood: all in-scope plans have substantive roi:go — full mission pass.";
    } else if (canPartialCheckpoint) {
      verdict = "pass";
      verifyPayload.allow_partial_verification = true;
      notes = `Dogfood: partial checkpoint pass (${substantivePlans} substantive, mission incomplete).`;
      note("INFO", "partial-checkpoint", "verify_evaluate(pass, allow_partial_verification: true)");
    } else if (substantivePlans > 0) {
      verdict = "partial";
      notes =
        "Dogfood: substantive roi:go present but partial checkpoint not eligible — using verdict partial.";
    }

    verifyPayload.verdict = verdict;
    verifyPayload.notes = notes;

    if (strictVerify && verdict === "pass") {
      verifyPayload.require_verified_proof = true;
    }
    let verifyResult;
    try {
      verifyResult = await call(client, "verify_evaluate", verifyPayload);
    } catch (err) {
      if (strictVerify && String(err.message ?? err).includes("require_verified_proof")) {
        note("PASS", "strict-verify-gate", "verify_evaluate correctly blocked pass without mcp_verified go");
        log("\n=== roi:drive final summary ===");
        log(`Mission ID: ${missionId}`);
        log("Strict verify: blocked pass (expected when trust is agent_claimed)");
        return;
      }
      throw err;
    }
    step(`verified ${verdict}`);
    note("PASS", "verify_evaluate", `status: ${verifyResult.status ?? "?"}, next: ${(verifyResult.next_actions ?? []).join(", ")}`);
  } else {
    note("INFO", "verify-skip", `no verify_gate dispatch (run=${runStatus}, next=${nextActions.join(",")})`);
  }

  log("\n── Step 6: final status_get ──");
  const finalStatus = await call(client, "status_get", { mission_id: missionId });
  const finalSummary = finalStatus.summary ?? finalStatus;
  note("PASS", "final-state", `evidence_count: ${finalSummary.evidence_count ?? "?"}`);

  log("\n=== roi:drive final summary ===");
  log(`Mission ID:    ${missionId}`);
  log(`Run status:    ${runStatus}`);
  log(`Compound go:   ${needsGoFirst && !driveOnly ? "yes" : "no"}`);
  log(`Strict verify: ${strictVerify}`);
  log(`Proof trust:   ${finalSummary.implementation_proof_trust ?? proofTrust ?? "?"}`);
  log(`Next actions:  ${(finalSummary.next_actions ?? []).join(", ") || "(empty)"}`);
}

async function legacyFreshDogfood(client, dbPath) {
  log("\n=== roi:drive legacy fresh mission dogfood ===\n");
  const created = await call(client, "mission_create", {
    title: "Write a short article on prompt caching best practices",
    goal: "Produce a 600-word article explaining prompt caching concepts."
  });
  const missionId = created.mission?.id ?? created.id;
  step("mission created");
  await call(client, "brief_revise", {
    mission_id: missionId,
    assumptions: ["Reader is technical"],
    constraints: ["600 words max"],
    success_criteria: ["Explains prompt caching"],
    audience: "LLM operators",
    non_goals: []
  });
  step("brief revised");
  const planGen = await call(client, "plan_generate", { mission_id: missionId });
  const plans = planGen.plans ?? [];
  const activePlanId = plans[0]?.id;
  const runCreated = await call(client, "run_create", {
    mission_id: missionId,
    plan_id: activePlanId,
    mode: "local"
  });
  const runId = runCreated.run?.id ?? runCreated.id;
  step("run created (lifecycle-only — no compound go on fresh article mission)");
  note("INFO", "legacy-path", "fresh mission typically lacks roi:go-first navigation");
  const statusAfter = await call(client, "status_get", { mission_id: missionId });
  note("INFO", "legacy-next_actions", (statusAfter.summary?.next_actions ?? []).join(", "));
  log(`Mission ID: ${missionId}, run: ${runId}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

let dbPath = dbPathArg ?? defaultDb;
let tmpDir;
if (legacyFresh) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-drive-dogfood-"));
  dbPath = path.join(tmpDir, "dogfood.sqlite");
}

if (!legacyFresh && !fs.existsSync(dbPath)) {
  console.error(`ROI DB not found: ${dbPath}`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  cwd: roiRoot,
  env: { ...process.env, ROI_SQLITE_PATH: dbPath }
});

const client = new Client({ name: "roi-drive-dogfood", version: "0.1.2" });

try {
  await client.connect(transport);
  if (legacyFresh) {
    await legacyFreshDogfood(client, dbPath);
  } else {
    const missionId = missionIdArg ?? defaultMissionId;
    await compoundDriveDogfood(client, missionId, dbPath);
  }
} finally {
  try {
    await client.close();
  } catch {
    /* ignore */
  }
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const findingsPath = path.join(__dirname, "dogfood-roi-drive-findings.md");
const md = [
  "# roi:drive Dogfood Findings",
  "",
  `Date: ${new Date().toISOString().slice(0, 10)}`,
  legacyFresh
    ? "Mode: legacy-fresh (ephemeral article mission)"
    : `Mode: compound actuation (mission ${missionIdArg ?? defaultMissionId})`,
  `DB: ${dbPath}`,
  `Drive only: ${driveOnly}`,
  "",
  "## Tool call trace",
  "",
  legacyFresh
    ? "mission_create → brief_revise → plan_generate → run_create → status_get"
    : "status_get → (dogfood-roi-go.mjs when roi:go first) → status_get → evidence_list → verify_evaluate? → status_get",
  "",
  "## Findings",
  "",
  ...findings.map((f) => `- **[${f.severity}]** \`${f.tag}\`: ${f.detail}`),
  "",
  "## Skill observations",
  "",
  "- Compound drive must chain `roi:go` when `next_actions` leads with `roi:go`, then re-enter drive.",
  "- When `partial_verification_eligible` and substantive go exists, dogfood uses `verify_evaluate(pass, allow_partial_verification: true)` instead of blocking.",
  "- U2 oracles: `go test ./internal/mcp/server/... -run TestMCPServerHubSmoke` and `TestInprocessMCP` in cmd (latter may be follow-up).",
  ""
].join("\n");

fs.writeFileSync(findingsPath, md);
console.log(`\nFindings written to ${findingsPath}`);
