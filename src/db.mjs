import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const defaultSchemaVersion = 2;

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 30000;");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roi_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const currentVersion =
    Number(db.prepare("SELECT value FROM roi_meta WHERE key = ?").get("schema_version")?.value ?? 0);

  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      owner TEXT NOT NULL,
      workspace_refs_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS briefs (
      mission_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, revision)
    );

    CREATE TABLE IF NOT EXISTS research_records (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      mission_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, revision)
    );

    CREATE TABLE IF NOT EXISTS context_packs (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_decisions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protocol_bindings (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      mission_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, revision)
    );

    CREATE TABLE IF NOT EXISTS routing_decisions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capability_activations (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_records (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      activation_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS convergence_controllers (
      mission_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS convergence_seams (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_mission_id ON tasks (mission_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks (run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_mission_id ON runs (mission_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_mission_id ON evidence (mission_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_run_id ON evidence (run_id);
    CREATE INDEX IF NOT EXISTS idx_traces_mission_id ON traces (mission_id);
    CREATE INDEX IF NOT EXISTS idx_traces_run_id ON traces (run_id);
    CREATE INDEX IF NOT EXISTS idx_routing_decisions_mission_id ON routing_decisions (mission_id);
    CREATE INDEX IF NOT EXISTS idx_capability_activations_mission_id ON capability_activations (mission_id);
    CREATE INDEX IF NOT EXISTS idx_capability_activations_run_id ON capability_activations (run_id);
    CREATE INDEX IF NOT EXISTS idx_review_records_mission_id ON review_records (mission_id);
    CREATE INDEX IF NOT EXISTS idx_review_records_run_id ON review_records (run_id);
    CREATE INDEX IF NOT EXISTS idx_policy_decisions_mission_id ON policy_decisions (mission_id);
    CREATE INDEX IF NOT EXISTS idx_policy_decisions_run_id ON policy_decisions (run_id);
  `);

  db.prepare(
    `
      INSERT INTO roi_meta(key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run("schema_version", String(defaultSchemaVersion));
}
