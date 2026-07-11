import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const defaultSchemaVersion = 3;

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  // foreign_keys is enabled defensively, but the schema intentionally stores
  // each entity as a serialized `data_json` blob keyed by an opaque id rather
  // than as normalized columns with REFERENCES clauses. Referential integrity is
  // therefore enforced in the service layer (existence checks before writes),
  // not by SQLite FKs. The pragma is a no-op against the current blob schema and
  // is kept only so any future normalized column with a real FK is enforced.
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 30000;");
  try {
    withTransaction(db, () => migrate(db));
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/**
 * Run `fn` inside a single `BEGIN IMMEDIATE … COMMIT` transaction so that a
 * multi-statement service mutation is atomic: either every write lands or none
 * does. `BEGIN IMMEDIATE` takes the write lock up front, so concurrent helper
 * processes serialize cleanly under `busy_timeout` instead of interleaving at
 * statement granularity.
 *
 * Only safe for synchronous `fn`. Do NOT wrap work that awaits I/O (e.g. an
 * A2A network round-trip) — a held SQLite write lock must not span an await.
 */
export function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE;");
  let result;
  try {
    result = fn();
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      /* rollback best-effort; surface the original error */
    }
    throw err;
  }
  db.exec("COMMIT;");
  return result;
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
  if (currentVersion > defaultSchemaVersion) {
    throw new Error(
      `unsupported newer ROI schema version ${currentVersion}; this runtime supports ${defaultSchemaVersion}`
    );
  }

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

    CREATE TABLE IF NOT EXISTS orientation_checkpoints (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_revision INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_orientation_checkpoints_mission_id ON orientation_checkpoints (mission_id);
    CREATE INDEX IF NOT EXISTS idx_orientation_checkpoints_plan_revision ON orientation_checkpoints (plan_id, plan_revision);
    CREATE INDEX IF NOT EXISTS idx_orientation_checkpoints_run_id ON orientation_checkpoints (run_id);
    CREATE INDEX IF NOT EXISTS idx_orientation_checkpoints_task_id ON orientation_checkpoints (task_id);
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

  // Versioned migration steps. The block above is the idempotent baseline
  // (CREATE TABLE/INDEX IF NOT EXISTS) shared by fresh and existing databases.
  // Each entry below transforms an *existing* database from its prior version
  // to the next. Steps run in order, only those newer than the on-disk
  // `currentVersion`, and the stamped version reflects what actually applied —
  // so a future ALTER TABLE / backfill lands on existing data instead of being
  // silently skipped by a no-op CREATE TABLE IF NOT EXISTS. Append-only: never
  // mutate a shipped step; add the next version with a higher key.
  const migrationSteps = new Map([
    // [targetVersion, (db) => { /* ALTER TABLE …, backfill … */ }],
  ]);

  let applied = currentVersion;
  for (const [targetVersion, step] of migrationSteps) {
    if (targetVersion > applied) {
      step(db);
      applied = targetVersion;
    }
  }
  const reachedVersion = Math.max(applied, defaultSchemaVersion);

  db.prepare(
    `
      INSERT INTO roi_meta(key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run("schema_version", String(reachedVersion));
}
