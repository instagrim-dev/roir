import assert from "node:assert/strict";
import test from "node:test";
import { AgentExecutor, AGENT_IMPLEMENT_HANDOFF_PREFIX } from "../src/agentExecutor.mjs";
import { isHostImplementHandoffOutput, isLocalImplementStubOutput } from "../src/implementationProof.mjs";

test("AgentExecutor emits non-stub handoff output", () => {
  const executor = new AgentExecutor();
  const output = executor.execute({
    prompt: "add hub smoke tests",
    missionId: "mission_1",
    runId: "run_1",
    planId: "plan_1",
    actions: ["add tests"],
    verificationTargets: ["go test -run Hub"]
  });
  assert.ok(output.startsWith(AGENT_IMPLEMENT_HANDOFF_PREFIX));
  assert.equal(isLocalImplementStubOutput(output), false);
  assert.equal(isHostImplementHandoffOutput(output), true);
  const payload = JSON.parse(output.split("\n").slice(1).join("\n"));
  assert.equal(payload.kind, AGENT_IMPLEMENT_HANDOFF_PREFIX);
  assert.equal(payload.next_action, "roi:go");
});
