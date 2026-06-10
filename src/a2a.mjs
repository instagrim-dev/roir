import crypto from "node:crypto";
import { ClientFactory } from "@a2a-js/sdk/client";

const ALLOWED_A2A_SCHEMES = new Set(["http:", "https:"]);

// Block targets that would let an operator-supplied (or imported-plan-supplied)
// agent card URL reach internal infrastructure (SSRF). ROI is a local-first
// reference (SECURITY.md): delegating to a service on the operator's OWN machine
// (loopback) is the documented normal case, so plain loopback is allowed by
// default. The SSRF value an attacker seeks is reaching *other* hosts' internal
// services and cloud metadata — those are blocked by default, with an explicit
// `ROI_A2A_ALLOW_PRIVATE=1` escape hatch for operators who deliberately delegate
// to a private-range peer they control.
function isBlockedA2AHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    return true;
  }
  // Loopback is the documented local-first happy path (127.0.0.0/8, ::1,
  // localhost): it only reaches the operator's own machine, which they already
  // fully control, so it is NOT an SSRF escape and is allowed by default.
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return false;
  }
  // Cloud metadata endpoint — the canonical SSRF target; always blocked by default.
  if (host === "169.254.169.254" || host === "metadata" || host === "metadata.google.internal") {
    return true;
  }
  // IPv6 unspecified / unique-local / link-local (loopback ::1 handled above).
  if (host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return false; // loopback 127.0.0.0/8 — operator's own machine
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 10) return true; // RFC1918 10/8
    if (a === 169 && b === 254) return true; // link-local (covers metadata range)
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16/12
    if (a === 192 && b === 168) return true; // RFC1918 192.168/16
  }
  return false;
}

export function assertSafeAgentCardUrl(agentCardUrl, { allowPrivate } = {}) {
  let parsed;
  try {
    parsed = new URL(String(agentCardUrl));
  } catch {
    throw new Error(`a2a_agent_card_url is not a valid URL: ${agentCardUrl}`);
  }
  if (!ALLOWED_A2A_SCHEMES.has(parsed.protocol)) {
    throw new Error(
      `a2a_agent_card_url scheme must be http or https: ${agentCardUrl}`
    );
  }
  const permitPrivate =
    allowPrivate ?? process.env.ROI_A2A_ALLOW_PRIVATE === "1";
  if (!permitPrivate && isBlockedA2AHostname(parsed.hostname)) {
    throw new Error(
      `a2a_agent_card_url resolves to a blocked private/loopback target (set ROI_A2A_ALLOW_PRIVATE=1 to override): ${agentCardUrl}`
    );
  }
  return parsed;
}

export class A2AExecutor {
  constructor({ clientFactory, allowPrivate } = {}) {
    this.clientFactory = clientFactory ?? new ClientFactory();
    this.allowPrivate = allowPrivate;
  }

  async invoke({ agentCardUrl, taskId = "", contextId = "", message = "" }) {
    if (!agentCardUrl) {
      throw new Error("a2a_agent_card_url is required for A2A execution");
    }

    assertSafeAgentCardUrl(agentCardUrl, { allowPrivate: this.allowPrivate });

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
