import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db.mjs";
import { ROIService } from "../src/service.mjs";
import { materializeBundle, materializationKey } from "../src/ceMaterialize.mjs";

const bundleFixture = new URL("../fixtures/ce-plan-bundle.example.json", import.meta.url);
const exampleBundle = JSON.parse(fs.readFileSync(bundleFixture, "utf8"));

test("materializationKey is stable", () => {
  const a = materializationKey("m1", "p1", "b1", "u1");
  const b = materializationKey("m1", "p1", "b1", "u1");
  assert.equal(a, b);
  assert.notEqual(materializationKey("m1", "p1", "b1", "u2"), a);
});

test("materializeBundle creates tasks and skips on second run", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-ce-mat-"));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const db = openDatabase(path.join(dir, "roi.sqlite"));
  t.after(() => {
    try {
      db.close?.();
    } catch {}
  });
  const service = new ROIService({ db });
  const { mission } = service.missionCreate({
    title: "CE materialization test",
    goal: "idempotency"
  });

  const first = materializeBundle(service, { mission_id: mission.id, bundle: exampleBundle });
  assert.equal(first.created.length, exampleBundle.units.length);
  assert.equal(first.skipped.length, 0);

  const second = materializeBundle(service, { mission_id: mission.id, bundle: exampleBundle });
  assert.equal(second.created.length, 0);
  assert.equal(second.skipped.length, exampleBundle.units.length);

  const list = service.taskList({ mission_id: mission.id }).tasks;
  assert.equal(list.length, exampleBundle.units.length);
  for (const task of list) {
    assert.equal(task.kind, "ce_materialized");
    assert.ok(task.payload?.ce?.materialization_key);
    assert.equal(task.payload.ce.bundle_id, exampleBundle.bundle_id);
  }
});
