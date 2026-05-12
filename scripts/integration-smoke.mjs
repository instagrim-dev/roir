#!/usr/bin/env node
/**
 * Integration smoke harness for the ROI MCP server.
 *
 * Connects via stdio, verifies:
 *   Phase 1 — listTools: count ≥ 50, all 11 ergonomic command tools present
 *   Phase 2 — mission_list: returns an object with a missions array
 *   Phase 3 — status_get: routing is live (any non-crash response)
 *
 * Exit 0 on success. Exit 1 on any failure.
 * Never touches the real bmo.db — uses a temp SQLite path.
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

// These 11 tools back the ergonomic command vocabulary defined in:
//   roi/AGENTS.md, .cursor/rules/roi-commands.mdc, .github/copilot-instructions.md
const REQUIRED_TOOLS = [
  "mission_create",
  "mission_list",
  "status_get",
  "plan_generate",
  "run_create",
  "run_cancel",
  "verify_evaluate",
  "evidence_record",
  "evidence_list",
  "brief_revise",
  "enlighten_run",
];

const MIN_TOOL_COUNT = 50;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roi-integration-smoke-"));
const dbPath = path.join(tmpDir, "smoke.sqlite");

function fail(msg) {
  console.error(`✗ FAIL: ${msg}`);
  process.exitCode = 1;
}

function step(msg) {
  console.log(`→ ${msg}`);
}

function unwrapText(result) {
  const text = result.content?.[0]?.text ?? result.content;
  if (typeof text === "string") {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  cwd: roiRoot,
  env: { ...process.env, ROI_SQLITE_PATH: dbPath },
});

const client = new Client({ name: "roi-integration-smoke", version: "0.1.0" });

try {
  await client.connect(transport);

  // ── Phase 1: listTools ────────────────────────────────────────────────────
  step("Phase 1: listTools");
  const listed = await client.listTools();
  const tools = listed.tools ?? [];
  const names = new Set(tools.map((t) => t.name));

  if (tools.length < MIN_TOOL_COUNT) {
    fail(`Expected ≥ ${MIN_TOOL_COUNT} tools, got ${tools.length}`);
  } else {
    console.log(`  ✓ tool count: ${tools.length} (≥ ${MIN_TOOL_COUNT})`);
  }

  const missing = REQUIRED_TOOLS.filter((n) => !names.has(n));
  if (missing.length > 0) {
    fail(`Missing required tools: ${missing.join(", ")}`);
  } else {
    console.log(`  ✓ all ${REQUIRED_TOOLS.length} required ergonomic tools present`);
  }

  // ── Phase 2: mission_list ─────────────────────────────────────────────────
  step("Phase 2: mission_list");
  const listResult = await client.callTool({ name: "mission_list", arguments: {} });
  if (listResult.isError) {
    fail(`mission_list returned error: ${JSON.stringify(listResult.content)}`);
  } else {
    const data = unwrapText(listResult);
    if (!data || !Array.isArray(data.missions)) {
      fail(`mission_list response missing 'missions' array: ${JSON.stringify(data)}`);
    } else {
      console.log(`  ✓ mission_list ok (${data.missions.length} missions in temp db)`);
    }
  }

  // ── Phase 3: status_get (routing probe) ───────────────────────────────────
  step("Phase 3: status_get routing probe");
  const statusResult = await client.callTool({
    name: "status_get",
    arguments: { mission_id: "smoke-nonexistent-000" },
  });
  // Any response (including "not found" error payload) proves routing is live.
  if (statusResult === undefined || statusResult === null) {
    fail("status_get returned undefined — routing may be broken");
  } else {
    console.log("  ✓ status_get routing live");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (!process.exitCode) {
    console.log(
      `\n✓ ROI MCP integration smoke passed` +
      ` (${tools.length} tools, mission_list ok, status_get ok)`
    );
  } else {
    console.log("\n✗ ROI MCP integration smoke FAILED — see errors above");
  }
} catch (err) {
  fail(`Unexpected error: ${err.message}`);
  console.error(err.stack);
} finally {
  try { await client.close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
