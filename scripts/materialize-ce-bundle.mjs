#!/usr/bin/env node
/**
 * Explicit CE plan bundle → ROI Task materialization (plan 008).
 *
 * Usage:
 *   node scripts/materialize-ce-bundle.mjs --bundle ../fixtures/ce-plan-bundle.example.json --mission-id <uuid>
 *   node scripts/materialize-ce-bundle.mjs -b path/to/bundle.json -m <mission_id> [--plan-id <id>] [--dry-run]
 *
 * Uses the same ROI SQLite as the lifecycle helper (ROI_SQLITE_PATH or .data/roi.sqlite under the ROI package root).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.mjs";
import { ROIService } from "../src/service.mjs";
import { materializeBundle } from "../src/ceMaterialize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");

function parseArgs(argv) {
  const out = { bundle: "", missionId: "", planId: "", dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--bundle" || a === "-b") {
      out.bundle = argv[++i] || "";
    } else if (a === "--mission-id" || a === "-m") {
      out.missionId = argv[++i] || "";
    } else if (a === "--plan-id" || a === "-p") {
      out.planId = argv[++i] || "";
    } else if (a.startsWith("--mission-id=")) {
      out.missionId = a.split("=", 2)[1] || "";
    } else if (a.startsWith("--bundle=")) {
      out.bundle = a.split("=", 2)[1] || "";
    } else if (a.startsWith("--plan-id=")) {
      out.planId = a.split("=", 2)[1] || "";
    }
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.bundle || !args.missionId) {
  console.error(
    "Usage: node scripts/materialize-ce-bundle.mjs --bundle <bundle.json> --mission-id <mission_id> [--plan-id <id>] [--dry-run]"
  );
  process.exit(1);
}

const bundlePath = path.isAbsolute(args.bundle) ? args.bundle : path.resolve(roiRoot, args.bundle);
const raw = fs.readFileSync(bundlePath, "utf8");
const bundle = JSON.parse(raw);

function defaultDbPath() {
  if (process.env.ROI_SQLITE_PATH && process.env.ROI_SQLITE_PATH.trim()) {
    return process.env.ROI_SQLITE_PATH.trim();
  }
  return path.join(roiRoot, ".data", "roi.sqlite");
}

const dbPath = defaultDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);
const service = new ROIService({ db });
const { mission } = service.missionGet({ mission_id: args.missionId });
if (!mission) {
  console.error(`error: mission ${args.missionId} not found`);
  process.exit(1);
}

if (args.dryRun) {
  console.log("dry-run: would materialize", bundle.units?.length ?? 0, "unit(s) for mission", args.missionId);
  process.exit(0);
}

const { created, skipped } = materializeBundle(service, {
  mission_id: args.missionId,
  plan_id: args.planId,
  bundle
});

console.log(
  JSON.stringify(
    {
      status: "ok",
      created_count: created.length,
      skipped_count: skipped.length,
      created_ids: created.map((t) => t.id),
      skipped
    },
    null,
    2
  )
);
