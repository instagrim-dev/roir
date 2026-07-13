import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.mjs";
import { ImmutableExportError, exportImmutableSnapshot } from "../src/immutableExport.mjs";

function fixtureDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "roi-immutable-export-"));
  const dbPath = path.join(directory, "roi.sqlite");
  const db = openDatabase(dbPath);
  db.prepare("INSERT INTO missions(id, title, goal, status, priority, owner, workspace_refs_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("mission-1", "Mission", "Goal", "active", "normal", "owner", "[]", "2026-07-12T00:00:00Z", "2026-07-12T00:00:00Z");
  db.prepare("INSERT INTO briefs(mission_id, revision, data_json, created_at) VALUES (?, ?, ?, ?)").run("mission-1", 1, JSON.stringify({ revision: 1 }), "2026-07-12T00:00:00Z");
  db.prepare("INSERT INTO briefs(mission_id, revision, data_json, created_at) VALUES (?, ?, ?, ?)").run("mission-1", 2, JSON.stringify({ revision: 2 }), "2026-07-12T00:00:01Z");
  db.prepare("INSERT INTO research_records(id, mission_id, data_json, created_at) VALUES (?, ?, ?, ?)").run("research-1", "mission-1", JSON.stringify({ id: "research-1" }), "2026-07-12T00:00:00Z");
  db.prepare("INSERT INTO context_packs(id, mission_id, data_json, generated_at) VALUES (?, ?, ?, ?)").run("context-1", "mission-1", JSON.stringify({ id: "context-1" }), "2026-07-12T00:00:00Z");
  db.prepare("INSERT INTO runs(id, mission_id, data_json, started_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("run-1", "mission-1", JSON.stringify({ id: "run-1", state: "completed" }), "2026-07-12T00:00:00Z", "2026-07-12T00:00:00Z");
  db.prepare("INSERT INTO traces(id, mission_id, run_id, task_id, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("trace-1", "mission-1", "run-1", "", JSON.stringify({ id: "trace-1" }), "2026-07-12T00:00:00Z");
  db.close();
  return { directory, dbPath };
}

function state(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((file) => fs.existsSync(file) ? [file, fs.statSync(file).size, fs.statSync(file).mtimeMs] : [file, "absent"]);
}

test("immutable exporter emits one coherent read-only manifest", () => {
  const { directory, dbPath } = fixtureDb();
  try {
    const before = state(dbPath);
    const manifest = exportImmutableSnapshot({ dbPath, missionId: "mission-1" });
    assert.equal(manifest.schema_version, "roi-immutable-export/v1");
    assert.equal(manifest.capture_boundary.transaction, "read_only_snapshot");
    assert.deepEqual(before, state(dbPath));
    assert.ok(manifest.records.some((record) => record.kind === "run" && record.id === "run-1"));
    assert.ok(manifest.manifest_digest.startsWith("sha256:"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("immutable exporter captures every mission-scoped table with collision-free ids", () => {
  const { directory, dbPath } = fixtureDb();
  try {
    const manifest = exportImmutableSnapshot({ dbPath, missionId: "mission-1" });
    // research_records and context_packs are mission-scoped and must not be dropped.
    assert.ok(manifest.records.some((record) => record.kind === "research_record" && record.id === "research-1"));
    assert.ok(manifest.records.some((record) => record.kind === "context_pack" && record.id === "context-1"));
    // Two brief revisions must survive as two distinct, uniquely-keyed records.
    const briefs = manifest.records.filter((record) => record.kind === "brief");
    assert.equal(briefs.length, 2);
    assert.equal(new Set(briefs.map((record) => record.id)).size, 2);
    assert.deepEqual(briefs.map((record) => record.revision).sort(), [1, 2]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("immutable exporter classifies absent and old-schema sources", () => {
  assert.throws(() => exportImmutableSnapshot({ dbPath: "/tmp/roi-does-not-exist.sqlite", missionId: "mission-1" }), (error) => error instanceof ImmutableExportError && error.code === "source_absent");
  const { directory, dbPath } = fixtureDb();
  try {
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE roi_meta SET value = '2' WHERE key = 'schema_version'").run();
    db.close();
    assert.throws(() => exportImmutableSnapshot({ dbPath, missionId: "mission-1" }), (error) => error instanceof ImmutableExportError && error.code === "unsupported_schema");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("immutable exporter rejects a source changed after its capture boundary", () => {
  const { directory, dbPath } = fixtureDb();
  try {
    assert.throws(() => exportImmutableSnapshot({ dbPath, missionId: "mission-1", afterSnapshot() {
      const writer = new DatabaseSync(dbPath);
      writer.prepare("UPDATE missions SET updated_at = ? WHERE id = ?").run("2026-07-12T01:00:00Z", "mission-1");
      writer.close();
    } }), (error) => error instanceof ImmutableExportError && error.code === "concurrent_write");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
