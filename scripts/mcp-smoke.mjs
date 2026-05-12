#!/usr/bin/env node
/**
 * Spawns the ROI MCP server with a temp SQLite file and verifies listTools + mission_list.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roiRoot = path.join(__dirname, "..");
const serverPath = path.join(roiRoot, "src", "server.mjs");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-mcp-smoke-"));
const dbPath = path.join(tmpDir, "smoke.sqlite");

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  cwd: roiRoot,
  env: {
    ...process.env,
    ROI_SQLITE_PATH: dbPath
  }
});

const client = new Client({ name: "roi-mcp-smoke", version: "0.0.1" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (!listed.tools?.length) {
    throw new Error("listTools returned no tools");
  }
  const names = new Set(listed.tools.map((t) => t.name));
  if (!names.has("mission_list")) {
    throw new Error("expected mission_list in tool list");
  }
  if (!names.has("enlighten_run")) {
    throw new Error("expected enlighten_run in tool list");
  }
  const result = await client.callTool({ name: "mission_list", arguments: {} });
  if (result.isError) {
    throw new Error(`mission_list failed: ${JSON.stringify(result)}`);
  }
  console.log("mcp-smoke: ok (listTools + mission_list)");
} finally {
  try {
    await client.close();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
