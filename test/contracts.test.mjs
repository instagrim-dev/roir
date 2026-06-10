import assert from "node:assert/strict";
import test from "node:test";
import {
  ToolSchemas,
  TaskStatus,
  MissionStatus
} from "../src/contracts.mjs";

// Cluster C — status fields are tightened from free-form strings to enums so an
// arbitrary/typo'd status can never reach the state machine through the dispatch
// boundary (ToolSchemas validation in scripts/lifecycle.mjs).

test("taskTransition.status accepts a real TaskStatus and rejects an arbitrary string", () => {
  const ok = ToolSchemas.taskTransition.safeParse({
    task_id: "t1",
    status: TaskStatus.RUNNING
  });
  assert.equal(ok.success, true, "a real TaskStatus must validate");

  const bad = ToolSchemas.taskTransition.safeParse({
    task_id: "t1",
    status: "totally-not-a-status"
  });
  assert.equal(bad.success, false, "an arbitrary status string must be rejected");

  // status remains optional (transition may carry only checkpoint/retry changes).
  const omitted = ToolSchemas.taskTransition.safeParse({ task_id: "t1" });
  assert.equal(omitted.success, true, "status stays optional");
});

test("taskCreate.status is enum-validated and optional", () => {
  assert.equal(
    ToolSchemas.taskCreate.safeParse({ mission_id: "m1", status: TaskStatus.QUEUED }).success,
    true
  );
  assert.equal(
    ToolSchemas.taskCreate.safeParse({ mission_id: "m1", status: "bogus" }).success,
    false
  );
  assert.equal(ToolSchemas.taskCreate.safeParse({ mission_id: "m1" }).success, true);
});

test("missionUpdate.status only accepts ACTIVE or ARCHIVED", () => {
  assert.equal(
    ToolSchemas.missionUpdate.safeParse({ mission_id: "m1", status: MissionStatus.ACTIVE }).success,
    true
  );
  assert.equal(
    ToolSchemas.missionUpdate.safeParse({ mission_id: "m1", status: MissionStatus.ARCHIVED }).success,
    true
  );
  // A real TaskStatus value is NOT a valid mission status — the narrowed enum
  // catches cross-domain status confusion.
  assert.equal(
    ToolSchemas.missionUpdate.safeParse({ mission_id: "m1", status: TaskStatus.RUNNING }).success,
    false
  );
});

// Cluster A — the agent-card URL is validated as a URL at the contract boundary,
// before the runtime SSRF guard in a2a.mjs ever runs.
test("runCreate.a2a_agent_card_url must be a syntactically valid URL", () => {
  assert.equal(
    ToolSchemas.runCreate.safeParse({
      mission_id: "m1",
      mode: "a2a",
      a2a_agent_card_url: "https://agent.example.com/card"
    }).success,
    true
  );
  assert.equal(
    ToolSchemas.runCreate.safeParse({
      mission_id: "m1",
      mode: "a2a",
      a2a_agent_card_url: "not a url"
    }).success,
    false
  );
  // Still optional for non-a2a modes.
  assert.equal(
    ToolSchemas.runCreate.safeParse({ mission_id: "m1", mode: "local" }).success,
    true
  );
});
