#!/usr/bin/env node
/**
 * Integration smoke harness for the ROI lifecycle helper.
 *
 * The canonical interface for ROI is the skill files under `roi/skills/`.
 * Skills shell to `node roi/scripts/lifecycle.mjs <verb>` to persist state.
 * This smoke drives the helper as a subprocess (the same way skills do) so
 * the test mirrors real usage rather than importing service.mjs directly.
 *
 * Phases:
 *   Phase 1 — `--list-verbs` returns the canonical surface; all 11 ergonomic
 *             verbs that back the `roi:*` command vocabulary are present.
 *   Phase 2 — `mission_list` against a fresh temp DB returns
 *             `{ missions: [] }`.
 *   Phase 3 — `mission_create` → `status_get` round-trip: schema is live,
 *             SQLite persistence is healthy, status routing returns a
 *             populated object with `next_actions`.
 *   Phase 4 — Error paths: unknown verb exits 1 with a helpful message;
 *             malformed JSON exits 1; service-thrown error (e.g. missing
 *             required arg) exits 1 with a `lifecycle: <verb> failed:`
 *             stderr line.
 *
 * Exit 0 on success, 1 on any failure. Never touches the real
 * `roi/.data/roi.sqlite` — uses a temp SQLite path via ROI_SQLITE_PATH.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");
const helperPath = path.join(roiRoot, "scripts", "lifecycle.mjs");

// These 11 verbs back the ergonomic command vocabulary defined in:
//   .cursor/rules/roi-commands.mdc, roi/AGENTS.md, roi/.cursor/rules/roi-commands.mdc
const REQUIRED_VERBS = [
  "mission_create",
  "mission_list",
  "status_get",
  "plan_generate",
  "run_create",
  "run_cancel",
  "verify_evaluate",
  "evidence_record",
  "evidence_list",
  "brief_revise",
  "enlighten_run",
];

const MIN_VERB_COUNT = 40;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-integration-smoke-"));
const dbPath = path.join(tmpDir, "smoke.sqlite");

function fail(msg) {
  console.error(`✗ FAIL: ${msg}`);
  process.exitCode = 1;
}

function step(msg) {
  console.log(`→ ${msg}`);
}

/**
 * Spawn the helper as a subprocess and capture stdout/stderr/exit.
 * Returns { code, stdout, stderr } once the process exits.
 */
function runHelper(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [helperPath, ...args], {
      cwd: roiRoot,
      env: { ...process.env, ROI_SQLITE_PATH: dbPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    fail(`${label}: stdout was not valid JSON\n${stdout}`);
    return null;
  }
}

try {
  // ── Phase 1: --list-verbs ─────────────────────────────────────────────────
  step("Phase 1: --list-verbs");
  {
    const { code, stdout, stderr } = await runHelper(["--list-verbs"]);
    if (code !== 0) {
      fail(`--list-verbs exited ${code}; stderr: ${stderr}`);
    } else {
      const verbs = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      if (verbs.length < MIN_VERB_COUNT) {
        fail(`Expected ≥ ${MIN_VERB_COUNT} verbs, got ${verbs.length}`);
      } else {
        console.log(`  ✓ verb count: ${verbs.length} (≥ ${MIN_VERB_COUNT})`);
      }
      const present = new Set(verbs);
      const missing = REQUIRED_VERBS.filter((v) => !present.has(v));
      if (missing.length > 0) {
        fail(`Missing required ergonomic verbs: ${missing.join(", ")}`);
      } else {
        console.log(`  ✓ all ${REQUIRED_VERBS.length} required ergonomic verbs present`);
      }
    }
  }

  // ── Phase 2: mission_list on empty DB ─────────────────────────────────────
  step("Phase 2: mission_list (empty temp DB)");
  {
    const { code, stdout, stderr } = await runHelper(["mission_list", "{}"]);
    if (code !== 0) {
      fail(`mission_list exited ${code}; stderr: ${stderr}`);
    } else {
      const data = parseJson(stdout, "mission_list");
      if (data && Array.isArray(data.missions)) {
        if (data.missions.length === 0) {
          console.log(`  ✓ mission_list returned empty array on fresh DB`);
        } else {
          fail(`mission_list returned ${data.missions.length} missions; expected 0`);
        }
      } else if (data) {
        fail(`mission_list response missing 'missions' array: ${JSON.stringify(data)}`);
      }
    }
  }

  // ── Phase 3: mission_create → status_get round-trip ───────────────────────
  step("Phase 3: mission_create → status_get round-trip");
  let createdMissionId = null;
  {
    const args = JSON.stringify({
      title: "smoke-mission",
      goal: "Integration smoke verifying lifecycle helper end-to-end.",
    });
    const { code, stdout, stderr } = await runHelper(["mission_create", args]);
    if (code !== 0) {
      fail(`mission_create exited ${code}; stderr: ${stderr}`);
    } else {
      const data = parseJson(stdout, "mission_create");
      const missionId = data?.mission?.id;
      if (typeof missionId === "string" && missionId.length > 0) {
        createdMissionId = missionId;
        console.log(`  ✓ mission_create returned mission.id: ${createdMissionId}`);
        if (!Array.isArray(data.next_actions)) {
          fail(`mission_create response missing 'next_actions' array`);
        } else {
          console.log(`  ✓ mission_create surfaced next_actions: [${data.next_actions.join(", ")}]`);
        }
      } else if (data) {
        fail(`mission_create response missing 'mission.id': ${JSON.stringify(data)}`);
      }
    }
  }

  if (createdMissionId) {
    const args = JSON.stringify({ mission_id: createdMissionId });
    const { code, stdout, stderr } = await runHelper(["status_get", args]);
    if (code !== 0) {
      fail(`status_get exited ${code}; stderr: ${stderr}`);
    } else {
      const data = parseJson(stdout, "status_get");
      if (!data) {
        // parse error already reported
      } else {
        // status_get returns { summary: { mission: {id}, next_actions, ... } }
        // per ROIService.statusGet (the helper passes it through verbatim).
        const summary = data.summary ?? {};
        const statusMissionId = summary.mission?.id;
        const nextActions = summary.next_actions;
        if (statusMissionId !== createdMissionId) {
          fail(`status_get mission id mismatch: got ${statusMissionId}, want ${createdMissionId}`);
        } else if (!Array.isArray(nextActions)) {
          fail(`status_get response missing 'summary.next_actions' array: ${JSON.stringify(data)}`);
        } else {
          console.log(`  ✓ status_get returned mission with ${nextActions.length} next_actions: [${nextActions.join(", ")}]`);
        }
      }
    }
  }

  // ── Phase 4: error paths ──────────────────────────────────────────────────
  step("Phase 4: error paths");

  // 4a. Unknown verb → exit 1 with helpful stderr.
  {
    const { code, stderr } = await runHelper(["this_is_not_a_verb", "{}"]);
    if (code === 0) {
      fail(`unknown verb: expected non-zero exit, got 0`);
    } else if (!stderr.includes("unknown verb")) {
      fail(`unknown verb: stderr missing 'unknown verb' marker; got: ${stderr}`);
    } else {
      console.log(`  ✓ unknown verb exits non-zero with diagnostic message`);
    }
  }

  // 4b. Malformed JSON → exit 1 with parse-error stderr.
  {
    const { code, stderr } = await runHelper(["mission_list", "{not valid json"]);
    if (code === 0) {
      fail(`malformed JSON: expected non-zero exit, got 0`);
    } else if (!stderr.toLowerCase().includes("invalid json")) {
      fail(`malformed JSON: stderr missing 'invalid JSON' marker; got: ${stderr}`);
    } else {
      console.log(`  ✓ malformed JSON exits non-zero with parse-error message`);
    }
  }

  // 4c. Service-thrown error (mission_get with bogus id) → exit 1, stderr names verb.
  {
    const args = JSON.stringify({ mission_id: "smoke-nonexistent-000" });
    const { code, stderr } = await runHelper(["mission_get", args]);
    if (code === 0) {
      fail(`mission_get on bogus id: expected non-zero exit, got 0`);
    } else if (!stderr.includes("lifecycle: mission_get failed")) {
      fail(`mission_get error: stderr missing 'lifecycle: mission_get failed' marker; got: ${stderr}`);
    } else {
      console.log(`  ✓ service-thrown error exits non-zero with verb-tagged message`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (!process.exitCode) {
    console.log(
      `\n✓ ROI lifecycle integration smoke passed` +
      ` (verbs listed, mission_list ok, round-trip ok, error paths ok)`
    );
  } else {
    console.log("\n✗ ROI lifecycle integration smoke FAILED — see errors above");
  }
} catch (err) {
  fail(`Unexpected error: ${err.message}`);
  console.error(err.stack);
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
