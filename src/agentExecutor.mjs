/**
 * Host-agent implement handoff (D2) — MCP does not edit the product repo; the
 * Cursor/Codex host runs `roi:go` and records verification evidence.
 */

export const AGENT_IMPLEMENT_HANDOFF_PREFIX = "AGENT_IMPLEMENT_HANDOFF";

export class AgentExecutor {
  execute({ prompt, missionId, runId, planId, actions = [], verificationTargets = [] }) {
    const payload = {
      kind: AGENT_IMPLEMENT_HANDOFF_PREFIX,
      message:
        "Host agent must implement in the product repository via roi:go, then run_resume on this run.",
      mission_id: missionId,
      run_id: runId,
      plan_id: planId,
      actions,
      verification_targets: verificationTargets,
      prompt: String(prompt ?? "").trim(),
      next_action: "roi:go"
    };
    return `${AGENT_IMPLEMENT_HANDOFF_PREFIX}\n${JSON.stringify(payload, null, 2)}`;
  }
}
