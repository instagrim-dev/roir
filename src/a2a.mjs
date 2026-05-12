import crypto from "node:crypto";
import { ClientFactory } from "@a2a-js/sdk/client";

export class A2AExecutor {
  constructor({ clientFactory } = {}) {
    this.clientFactory = clientFactory ?? new ClientFactory();
  }

  async invoke({ agentCardUrl, taskId = "", contextId = "", message = "" }) {
    if (!agentCardUrl) {
      throw new Error("a2a_agent_card_url is required for A2A execution");
    }

    const client = await this.clientFactory.createFromUrl(agentCardUrl);

    if (taskId) {
      const task = await client.getTask({ id: taskId, historyLength: 20 });
      return normalizeTask(task);
    }

    const response = await client.sendMessage({
      configuration: {
        blocking: true,
        historyLength: 20,
        acceptedOutputModes: ["text/plain", "application/json"]
      },
      message: {
        kind: "message",
        messageId: crypto.randomUUID(),
        role: "user",
        contextId: contextId || undefined,
        parts: [
          {
            kind: "text",
            text: message
          }
        ]
      }
    });

    return normalizeResponse(response);
  }
}

function normalizeResponse(response) {
  if (!response || typeof response !== "object") {
    return {
      taskId: "",
      contextId: "",
      text: "",
      artifacts: [],
      statusMessage: "",
      state: "unknown",
      errorMessage: "empty_response"
    };
  }

  if (response.kind === "task") {
    return normalizeTask(response);
  }

  return {
    taskId: response.taskId || "",
    contextId: response.contextId || "",
    text: extractMessageText(response),
    artifacts: [],
    statusMessage: "",
    state: "completed",
    errorMessage: ""
  };
}

function normalizeTask(task) {
  const state = task?.status?.state || "unknown";
  const statusMessage = extractMessageText(task?.status?.message);
  const historyText = Array.isArray(task?.history)
    ? task.history.map((item) => extractMessageText(item)).filter(Boolean).join("\n")
    : "";

  return {
    taskId: task?.id || "",
    contextId: task?.contextId || "",
    text: statusMessage || historyText || extractArtifactText(task?.artifacts),
    artifacts: Array.isArray(task?.artifacts) ? task.artifacts : [],
    statusMessage,
    state,
    errorMessage: state === "failed" || state === "rejected" ? (statusMessage || "remote_failure") : ""
  };
}

function extractArtifactText(artifacts) {
  if (!Array.isArray(artifacts)) {
    return "";
  }
  return artifacts
    .flatMap((artifact) => Array.isArray(artifact?.parts) ? artifact.parts : [])
    .map((part) => {
      if (part?.kind === "text") {
        return part.text || "";
      }
      if (part?.kind === "data") {
        return JSON.stringify(part.data ?? {});
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractMessageText(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  return Array.isArray(message.parts)
    ? message.parts
        .map((part) => {
          if (part?.kind === "text") {
            return part.text || "";
          }
          if (part?.kind === "data") {
            return JSON.stringify(part.data ?? {});
          }
          return "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
}
