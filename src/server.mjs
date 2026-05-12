import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "./db.mjs";
import { ToolSchemas } from "./contracts.mjs";
import { ROIService } from "./service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createDefaultService({ dbPath } = {}) {
  const dataDir = path.join(__dirname, "..", ".data");
  const resolvedDBPath =
    dbPath ||
    (process.env.ROI_SQLITE_PATH && process.env.ROI_SQLITE_PATH.trim()) ||
    path.join(dataDir, "roi.sqlite");
  const db = openDatabase(resolvedDBPath);
  return new ROIService({ db });
}

/** Sorted list of MCP tool names for docs parity and CI. Does not open storage. */
export function getRegisteredToolNames() {
  // Empty service: handlers are never invoked; only names are read for docs/CI parity.
  const defs = toolDefinitions({});
  return defs.map((t) => t.name).sort();
}

export function buildServer({ service = createDefaultService() } = {}) {
  const server = new McpServer({
    name: "roi",
    version: "0.1.0"
  });

  for (const tool of toolDefinitions(service)) {
    server.registerTool(
      tool.name,
      {
        // Display name: dotted form (e.g. mission.create). The registered
        // `name` is underscore form for hosts (e.g. Cursor) that only allow
        // [A-Za-z0-9_].
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema
      },
      async (args) => {
        const result = await tool.handler(args ?? {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ],
          structuredContent: result
        };
      }
    );
  }

  return server;
}

export async function startServer({ service } = {}) {
  const server = buildServer({ service });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

/** Dotted id (e.g. mission.create) -> MCP tool id (mission_create) for strict hosts. */
function mcpToolId(dotted) {
  return dotted.replaceAll(".", "_");
}

function toolDefinitions(service) {
  return [
    tool("mission.create", "Create a mission and seed the first brief.", ToolSchemas.missionCreate, (args) => service.missionCreate(args)),
    tool("mission.get", "Get a mission by ID.", ToolSchemas.missionGet, (args) => service.missionGet(args)),
    tool("mission.list", "List missions.", ToolSchemas.missionList, (args) => service.missionList(args)),
    tool("mission.update", "Update mission fields.", ToolSchemas.missionUpdate, (args) => service.missionUpdate(args)),
    tool("mission.archive", "Archive a mission.", ToolSchemas.missionArchive, (args) => service.missionArchive(args)),
    tool("brief.revise", "Create a new brief revision.", ToolSchemas.briefRevise, (args) => service.briefRevise(args)),
    tool("brief.get_latest", "Get the latest brief revision.", ToolSchemas.briefGetLatest, (args) => service.briefGetLatest(args)),
    tool("brief.list_revisions", "List brief revisions.", ToolSchemas.briefListRevisions, (args) => service.briefListRevisions(args)),
    tool("research.record", "Record research findings.", ToolSchemas.researchRecord, (args) => service.researchRecord(args)),
    tool("research.list", "List research records.", ToolSchemas.researchList, (args) => service.researchList(args)),
    tool("research.summarize", "Summarize research records.", ToolSchemas.researchSummarize, (args) => service.researchSummarize(args)),
    tool("plan.generate", "Generate or store mission plans.", ToolSchemas.planGenerate, (args) => service.planGenerate(args)),
    tool("plan.get", "Get the latest revision of a plan.", ToolSchemas.planGet, (args) => service.planGet(args)),
    tool("plan.list", "List latest plans for a mission.", ToolSchemas.planList, (args) => service.planList(args)),
    tool("plan.revise", "Create a new revision of a plan.", ToolSchemas.planRevise, (args) => service.planRevise(args)),
    tool("plan.assign_waves", "Assign waves to plans.", ToolSchemas.planAssignWaves, (args) => service.planAssignWaves(args)),
    tool("task.create", "Create a task.", ToolSchemas.taskCreate, (args) => service.taskCreate(args)),
    tool("task.transition", "Transition a task.", ToolSchemas.taskTransition, (args) => service.taskTransition(args)),
    tool("task.list", "List tasks.", ToolSchemas.taskList, (args) => service.taskList(args)),
    tool("task.resume", "Resume a task.", ToolSchemas.taskResume, (args) => service.taskResume(args)),
    tool("run.create", "Create and execute a run locally or via A2A.", ToolSchemas.runCreate, (args) => service.runCreate(args)),
    tool("run.get", "Get a run.", ToolSchemas.runGet, (args) => service.runGet(args)),
    tool("run.list", "List runs.", ToolSchemas.runList, (args) => service.runList(args)),
    tool("run.resume", "Resume a paused run.", ToolSchemas.runResume, (args) => service.runResume(args)),
    tool("run.cancel", "Cancel a run.", ToolSchemas.runCancel, (args) => service.runCancel(args)),
    tool("evidence.record", "Record evidence.", ToolSchemas.evidenceRecord, (args) => service.evidenceRecord(args)),
    tool("evidence.list", "List evidence.", ToolSchemas.evidenceList, (args) => service.evidenceList(args)),
    tool("trace.record", "Record a trace.", ToolSchemas.traceRecord, (args) => service.traceRecord(args)),
    tool("trace.get", "Get a trace.", ToolSchemas.traceGet, (args) => service.traceGet(args)),
    tool("trace.list", "List traces.", ToolSchemas.traceList, (args) => service.traceList(args)),
    tool("policy.evaluate", "Evaluate policy for a run or task.", ToolSchemas.policyEvaluate, (args) => service.policyEvaluate(args)),
    tool("policy.record_decision", "Record a policy decision.", ToolSchemas.policyRecordDecision, (args) => service.policyRecordDecision(args)),
    tool("protocol.bind", "Record a protocol binding.", ToolSchemas.protocolBind, (args) => service.protocolBind(args)),
    tool("protocol.list_bindings", "List protocol bindings.", ToolSchemas.protocolListBindings, (args) => service.protocolListBindings(args)),
    tool("capability.register", "Register a promoted capability in the ROI registry.", ToolSchemas.capabilityRegister, (args) => service.capabilityRegister(args)),
    tool("capability.match", "Match a capability for a mission or plan without persisting a route.", ToolSchemas.capabilityMatch, (args) => service.capabilityMatch(args)),
    tool("route.resolve", "Resolve and persist a routing decision.", ToolSchemas.routeResolve, (args) => service.routeResolve(args)),
    tool("route.list", "List routing decisions.", ToolSchemas.routeList, (args) => service.routeList(args)),
    tool("activation.create", "Create a capability activation.", ToolSchemas.activationCreate, (args) => service.activationCreate(args)),
    tool("activation.get", "Get a capability activation.", ToolSchemas.activationGet, (args) => service.activationGet(args)),
    tool("activation.list", "List capability activations.", ToolSchemas.activationList, (args) => service.activationList(args)),
    tool("review.record", "Record a workflow review result.", ToolSchemas.reviewRecord, (args) => service.reviewRecord(args)),
    tool("review.get", "Get a workflow review record.", ToolSchemas.reviewGet, (args) => service.reviewGet(args)),
    tool("review.list", "List workflow review records.", ToolSchemas.reviewList, (args) => service.reviewList(args)),
    tool("pattern.detect", "Detect patterns from completed runs.", ToolSchemas.patternDetect, (args) => service.patternDetect(args)),
    tool("pattern.list", "List patterns.", ToolSchemas.patternList, (args) => service.patternList(args)),
    tool("capability.propose", "Propose a capability.", ToolSchemas.capabilityPropose, (args) => service.capabilityPropose(args)),
    tool("capability.promote", "Promote a proposed capability.", ToolSchemas.capabilityPromote, (args) => service.capabilityPromote(args)),
    tool("capability.list", "List capabilities.", ToolSchemas.capabilityList, (args) => service.capabilityList(args)),
    tool("verify.evaluate", "Evaluate verification for a run.", ToolSchemas.verifyEvaluate, (args) => service.verifyEvaluate(args)),
    tool("enlighten.run", "Run pattern detection plus capability proposal (roi:learn / learning pass).", ToolSchemas.enlightenRun, (args) => service.enlightenRun(args)),
    tool("status.get", "Get mission status summary.", ToolSchemas.statusGet, (args) => service.statusGet(args))
  ];
}

/**
 * @param {string} dotted e.g. "mission.create" (title / docs)
 * @returns {{ name: string, title: string, description: string, schema: unknown, handler: function }}
 */
function tool(dotted, description, schema, handler) {
  return {
    name: mcpToolId(dotted),
    title: dotted,
    description,
    schema,
    handler
  };
}

if (isMainModule()) {
  await startServer();
}

function isMainModule() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}
