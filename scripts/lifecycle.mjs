#!/usr/bin/env node
/**
 * ROI lifecycle helper — direct ROIService dispatcher.
 *
 * The canonical interface for ROI is the skill files under `skills/`.
 * Skills shell to this helper to persist state. There is no MCP server
 * in front of ROIService; this helper IS the persistence path.
 *
 * Contract:
 *   node scripts/lifecycle.mjs <verb> '<json-args>'
 *   node scripts/lifecycle.mjs <verb> -          # JSON args from stdin
 *   node scripts/lifecycle.mjs --list-verbs      # print verb registry
 *   node scripts/lifecycle.mjs --help
 *
 * Output: pretty-printed JSON of the service method's return value on stdout.
 * Exit code: 0 on success, 1 on service-thrown error or invalid usage.
 *
 * Storage: .data/roi.sqlite under the ROI package root by default; override
 * with ROI_SQLITE_PATH.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, withTransaction } from "../src/db.mjs";
import { ROIService } from "../src/service.mjs";
import { ToolSchemas } from "../src/contracts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");

// Verb registry. Exported so test/_helper-test-driver.mjs can derive its
// in-process verb map directly from this single source of truth — preventing
// the manual drift that bit the editorial/convergence harnesses when
// `src/server.mjs` was the canonical source.
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

// Verbs whose service method awaits I/O (e.g. an A2A network round-trip).
// These must NOT be wrapped in the synchronous SQLite transaction helper,
// because a held write lock must not span an await. They manage their own
// resumable state instead.
const ASYNC_NETWORK_VERBS = new Set(["run_create", "run_resume"]);

/**
 * Validate `args` for `method` against its ToolSchemas entry. Returns the
 * parsed (unknown-key-stripped, type-checked) value so untrusted JSON cannot
 * reach business logic unchecked. Methods without a schema entry pass through
 * unchanged. Throws an Error with a readable issue list on validation failure.
 */
export function validateArgs(method, args) {
  const schema = ToolSchemas[method];
  if (!schema) return args;
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid arguments: ${detail}`);
  }
  return parsed.data;
}

/**
 * Validate then dispatch a verb against the service. Synchronous verbs run
 * inside a single transaction so every write in the method is atomic;
 * async network verbs run outside the sync transaction wrapper.
 *
 * Shared by the CLI (scripts/lifecycle.mjs) and the in-process test driver
 * so validation + transaction semantics cannot drift between the two paths.
 */
export function dispatchVerb({ db, service, verb, method, args }) {
  const validated = validateArgs(method, args);
  if (ASYNC_NETWORK_VERBS.has(verb)) {
    return service[method](validated);
  }
  return withTransaction(db, () => service[method](validated));
}

function usage() {
  return [
    "Usage: node scripts/lifecycle.mjs <verb> '<json-args>'",
    "       node scripts/lifecycle.mjs <verb> -        # read JSON from stdin",
    "       node scripts/lifecycle.mjs --list-verbs",
    "       node scripts/lifecycle.mjs --help",
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
    result = await dispatchVerb({ db, service, verb, method, args });
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
