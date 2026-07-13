import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { defaultSchemaVersion } from "./db.mjs";

const SUPPORTED_SCHEMA_VERSION = defaultSchemaVersion;
const RECORD_TABLES = [
  ["brief", "briefs", "mission_id = ?", "revision ASC"],
  ["research_record", "research_records", "mission_id = ?", "id ASC"],
  ["plan", "plans", "mission_id = ?", "id ASC, revision ASC"],
  ["orientation_checkpoint", "orientation_checkpoints", "mission_id = ?", "id ASC"],
  ["context_pack", "context_packs", "mission_id = ?", "id ASC"],
  ["run", "runs", "mission_id = ?", "id ASC"],
  ["task", "tasks", "mission_id = ?", "id ASC"],
  ["evidence", "evidence", "mission_id = ?", "id ASC"],
  ["trace", "traces", "mission_id = ?", "id ASC"],
  ["policy_decision", "policy_decisions", "mission_id = ?", "id ASC"],
  ["protocol_binding", "protocol_bindings", "mission_id = ?", "id ASC"],
  ["pattern", "patterns", "mission_id = ?", "id ASC"],
  ["capability", "capabilities", "mission_id = ?", "id ASC, revision ASC"],
  ["routing_decision", "routing_decisions", "mission_id = ?", "id ASC"],
  ["capability_activation", "capability_activations", "mission_id = ?", "id ASC"],
  ["review_record", "review_records", "mission_id = ?", "id ASC"],
  ["convergence_controller", "convergence_controllers", "mission_id = ?", "mission_id ASC"],
  ["convergence_seam", "convergence_seams", "mission_id = ?", "id ASC"]
];

export class ImmutableExportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function parsePayload(row, table) {
  try {
    return JSON.parse(row.data_json);
  } catch (error) {
    throw new ImmutableExportError("invalid_source_record", `${table}/${row.id} has invalid data_json: ${error.message}`);
  }
}

function captureRecord(kind, table, row) {
  const payload = parsePayload(row, table);
  const revision = Number.isInteger(row.revision) ? row.revision : null;
  // Not every table has an `id` column (e.g. `briefs` and
  // `convergence_controllers` are keyed by (mission_id, revision) / mission_id).
  // Synthesize a stable, collision-free identity for those rows so consumers
  // that key records by `id` (dedup, integrity maps, diffs) never collapse
  // distinct revisions onto one identity.
  const id = row.id ?? (revision === null ? `${kind}:${row.mission_id}` : `${kind}:${row.mission_id}:${revision}`);
  return { kind, id, revision, digest: canonicalDigest(payload), payload };
}

function sourceFileState(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((file) => {
    try {
      const state = fs.statSync(file);
      return { file, size: state.size, mtime_ms: state.mtimeMs };
    } catch (error) {
      if (error.code === "ENOENT") return { file, absent: true };
      throw error;
    }
  });
}

export function exportImmutableSnapshot({ dbPath, missionId, afterSnapshot = null }) {
  if (!fs.existsSync(dbPath)) throw new ImmutableExportError("source_absent", `ROI source database is absent: ${dbPath}`);
  const beforeFiles = sourceFileState(dbPath);
  if (beforeFiles.slice(1).some((file) => !file.absent)) {
    throw new ImmutableExportError("active_wal_snapshot_unsupported", "ROI source has WAL or SHM state; exporter refuses an unsafe immutable read");
  }
  let db;
  try {
    // immutable=1 prevents SQLite from creating lock sidecars on a read-only source.
    db = new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=ro&immutable=1`, { readOnly: true });
  } catch (error) {
    throw new ImmutableExportError("source_unreadable", `ROI source database cannot be opened read-only: ${error.message}`);
  }
  try {
    const schema = db.prepare("SELECT value FROM roi_meta WHERE key = 'schema_version'").get();
    const schemaVersion = Number(schema?.value);
    if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new ImmutableExportError("unsupported_schema", `ROI source schema ${schema?.value ?? "absent"}; expected ${SUPPORTED_SCHEMA_VERSION}`);
    const beforeVersion = db.prepare("PRAGMA data_version").get().data_version;
    db.exec("BEGIN;");
    let manifest;
    try {
      const mission = db.prepare("SELECT * FROM missions WHERE id = ?").get(missionId);
      if (!mission) throw new ImmutableExportError("mission_absent", `ROI mission is absent: ${missionId}`);
      const records = [];
      for (const [kind, table, predicate, ordering] of RECORD_TABLES) {
        const rows = db.prepare(`SELECT * FROM ${table} WHERE ${predicate} ORDER BY ${ordering}`).all(missionId);
        records.push(...rows.map((row) => captureRecord(kind, table, row)));
      }
      const missionPayload = { id: mission.id, title: mission.title, goal: mission.goal, status: mission.status, priority: mission.priority, owner: mission.owner, workspace_refs: JSON.parse(mission.workspace_refs_json), created_at: mission.created_at, updated_at: mission.updated_at };
      manifest = { schema_version: "roi-immutable-export/v1", source: { database: dbPath, schema_version: schemaVersion, mission_id: missionId }, capture_boundary: { sqlite_data_version: beforeVersion, transaction: "read_only_snapshot" }, mission: { digest: canonicalDigest(missionPayload), payload: missionPayload }, records };
    } finally {
      db.exec("COMMIT;");
    }
    if (afterSnapshot) afterSnapshot();
    const afterVersion = db.prepare("PRAGMA data_version").get().data_version;
    if (afterVersion !== beforeVersion) throw new ImmutableExportError("concurrent_write", "ROI source changed during immutable snapshot capture");
    if (JSON.stringify(beforeFiles) !== JSON.stringify(sourceFileState(dbPath))) throw new ImmutableExportError("concurrent_write", "ROI source file or sidecar changed during immutable snapshot capture");
    return { ...manifest, manifest_digest: canonicalDigest(manifest) };
  } finally {
    db.close();
  }
}
