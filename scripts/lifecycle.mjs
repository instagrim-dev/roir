#!/usr/bin/env node
/**
 * ROI lifecycle helper — direct ROIService dispatcher.
 *
 * The canonical interface for ROI is the skill files under `roi/skills/`.
 * Skills shell to this helper to persist state. There is no MCP server
 * in front of ROIService; this helper IS the persistence path.
 *
 * Contract:
 *   node roi/scripts/lifecycle.mjs <verb> '<json-args>'
 *   node roi/scripts/lifecycle.mjs <verb> -          # JSON args from stdin
 *   node roi/scripts/lifecycle.mjs --list-verbs      # print verb registry
 *   node roi/scripts/lifecycle.mjs --help
 *
 * Output: pretty-printed JSON of the service method's return value on stdout.
 * Exit code: 0 on success, 1 on service-thrown error or invalid usage.
 *
 * Storage: roi/.data/roi.sqlite by default; override with ROI_SQLITE_PATH.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.mjs";
import { ROIService } from "../src/service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");

// Verb registry. Exported so test/_helper-test-driver.mjs can derive its
// in-process verb map directly from this single source of truth — preventing
// the manual drift that bit the editorial/convergence harnesses when
// `roi/src/server.mjs` was the canonical source.
//
// Each entry: [verb, methodName].
// Verb is snake_case to match historical MCP tool names and existing skill
// references; methodName is the camelCase ROIService method.
export const VERBS = [
  // mission
  ["mission_create", "missionCreate"],
  ["mission_get", "missionGet"],
  ["mission_list", "missionList"],
  ["mission_update", "missionUpdate"],
  ["mission_archive", "missionArchive"],
  // brief
  ["brief_revise", "briefRevise"],
  ["brief_get_latest", "briefGetLatest"],
  ["brief_list_revisions", "briefListRevisions"],
  // research
  ["research_record", "researchRecord"],
  ["research_list", "researchList"],
  ["research_summarize", "researchSummarize"],
  // plan
  ["plan_generate", "planGenerate"],
  ["plan_get", "planGet"],
  ["plan_list", "planList"],
  ["plan_revise", "planRevise"],
  ["plan_assign_waves", "planAssignWaves"],
  // task
  ["task_create", "taskCreate"],
  ["task_transition", "taskTransition"],
  ["task_list", "taskList"],
  ["task_resume", "taskResume"],
  // run
  ["run_create", "runCreate"],
  ["run_get", "runGet"],
  ["run_list", "runList"],
  ["run_resume", "runResume"],
  ["run_cancel", "runCancel"],
  // evidence
  ["evidence_record", "evidenceRecord"],
  ["evidence_list", "evidenceList"],
  // trace
  ["trace_record", "traceRecord"],
  ["trace_get", "traceGet"],
  ["trace_list", "traceList"],
  // policy
  ["policy_evaluate", "policyEvaluate"],
  ["policy_record_decision", "policyRecordDecision"],
  // protocol
  ["protocol_bind", "protocolBind"],
  ["protocol_list_bindings", "protocolListBindings"],
  // capability + routing
  ["capability_register", "capabilityRegister"],
  ["capability_match", "capabilityMatch"],
  ["capability_propose", "capabilityPropose"],
  ["capability_promote", "capabilityPromote"],
  ["capability_list", "capabilityList"],
  ["route_resolve", "routeResolve"],
  ["route_list", "routeList"],
  // activation
  ["activation_create", "activationCreate"],
  ["activation_get", "activationGet"],
  ["activation_list", "activationList"],
  // review
  ["review_record", "reviewRecord"],
  ["review_get", "reviewGet"],
  ["review_list", "reviewList"],
  // pattern + verify + enlighten + status (lifecycle gates)
  ["pattern_detect", "patternDetect"],
  ["pattern_list", "patternList"],
  ["verify_evaluate", "verifyEvaluate"],
  ["enlighten_run", "enlightenRun"],
  ["status_get", "statusGet"],
];

const VERB_TO_METHOD = new Map(VERBS);

export { VERB_TO_METHOD };

function usage() {
  return [
    "Usage: node roi/scripts/lifecycle.mjs <verb> '<json-args>'",
    "       node roi/scripts/lifecycle.mjs <verb> -        # read JSON from stdin",
    "       node roi/scripts/lifecycle.mjs --list-verbs",
    "       node roi/scripts/lifecycle.mjs --help",
    "",
    `Storage: ${defaultDbPath()} (override with ROI_SQLITE_PATH)`,
  ].join("\n");
}

function defaultDbPath() {
  if (process.env.ROI_SQLITE_PATH && process.env.ROI_SQLITE_PATH.trim()) {
    return process.env.ROI_SQLITE_PATH.trim();
  }
  return path.join(roiRoot, ".data", "roi.sqlite");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function die(msg, code = 1) {
  process.stderr.write(`lifecycle: ${msg}\n`);
  process.exit(code);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(usage() + "\n");
    process.exit(argv.length === 0 ? 1 : 0);
  }

  if (argv[0] === "--list-verbs") {
    for (const [verb] of VERBS) process.stdout.write(`${verb}\n`);
    process.exit(0);
  }

  const verb = argv[0];
  const method = VERB_TO_METHOD.get(verb);
  if (!method) {
    die(`unknown verb: ${verb}\n\n${usage()}`);
  }

  const argSource = argv[1] ?? "{}";
  let argsJson;
  if (argSource === "-") {
    argsJson = (await readStdin()).trim() || "{}";
  } else {
    argsJson = argSource;
  }

  let args;
  try {
    args = JSON.parse(argsJson);
  } catch (err) {
    die(`invalid JSON for verb '${verb}': ${err.message}`);
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    die(`verb '${verb}' requires a JSON object; got ${typeof args}`);
  }

  const dbPath = defaultDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  const service = new ROIService({ db });

  let result;
  try {
    result = await service[method](args);
  } catch (err) {
    process.stderr.write(`lifecycle: ${verb} failed: ${err.message}\n`);
    if (process.env.ROI_DEBUG) process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }

  const payload = result === undefined ? {} : result;
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

// Only execute as a CLI when this module is the script entry point. When
// imported (e.g. by test/_helper-test-driver.mjs to consume the VERBS
// registry), do not run main().
function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main().catch((err) => {
    process.stderr.write(`lifecycle: unexpected error: ${err.message}\n`);
    if (process.env.ROI_DEBUG) process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  });
}
